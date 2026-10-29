from datetime import UTC, datetime
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.models import AccountMovement, Currency
from app.report_pdf import money, render_monthly_report
from app.services import monthly_report


def post(client: TestClient, path: str, payload: dict, expected: int = 201) -> dict:
    response = client.post(path, json=payload)
    assert response.status_code == expected, response.text
    return response.json()


def tx(client: TestClient, account_id: int, kind: str, amount: str, day: str, **extra) -> dict:
    payload = {
        "description": extra.pop("description", "x"),
        "amount": amount,
        "type": kind,
        "date": day,
        "account_id": account_id,
        **extra,
    }
    return post(client, "/api/transactions", payload)


def deposit_at(client: TestClient, db: Session, account_id: int, reason: str, at: datetime) -> None:
    moved = post(
        client,
        "/api/movements/deposit",
        {"account_id": account_id, "amount": "10", "reason": reason},
    )
    db.execute(
        update(AccountMovement).where(AccountMovement.id == moved["id"]).values(created_at=at)
    )
    db.commit()


def seed(client: TestClient, db: Session) -> dict:
    brl = post(client, "/api/accounts", {"name": "Nubank", "initial_balance": "1000"})
    usd = post(
        client, "/api/accounts", {"name": "Wise", "initial_balance": "50", "currency": "USD"}
    )
    food = post(client, "/api/categories", {"name": "Mercado"})
    salary = post(client, "/api/categories", {"name": "Salário", "kind": "income"})
    budget = post(client, "/api/budgets", {"year": 2026, "month": 2})
    budget = post(client, f"/api/budgets/{budget['id']}/items", {"name": "Casa", "planned": "500"})
    item = budget["items"][0]

    tx(client, brl["id"], "income", "3000", "2026-02-05", category_id=salary["id"])
    tx(client, brl["id"], "expense", "450", "2026-02-10", category_id=food["id"],
       budget_item_id=item["id"], description="Feira <grande> & cia")  # fmt: skip
    tx(client, brl["id"], "expense", "50", "2026-02-11")
    tx(client, brl["id"], "expense", "800", "2026-01-15")
    tx(client, brl["id"], "income", "100", "2025-09-30")  # outside the 6-month window
    tx(client, usd["id"], "expense", "20", "2026-02-12")  # other currency
    # 01/02 00:30 UTC is still January at UTC-3; 01/03 02:00 UTC is still February.
    deposit_at(client, db, brl["id"], "janeiro local", datetime(2026, 2, 1, 0, 30, tzinfo=UTC))
    deposit_at(client, db, brl["id"], "fevereiro local", datetime(2026, 3, 1, 2, 0, tzinfo=UTC))
    return {"brl": brl, "usd": usd}


def test_report_gathers_the_month(client: TestClient, db_session: Session) -> None:
    seed(client, db_session)
    now = datetime(2026, 3, 5, 15, 0, tzinfo=UTC)
    report = monthly_report(db_session, 2026, 2, Currency.BRL, utc_offset_minutes=-180, now=now)

    assert (report.income, report.expense) == (Decimal("3000.00"), Decimal("500.00"))
    assert report.generated_at.isoformat() == "2026-03-05T12:00:00-03:00"
    # Six months up to February, crossing into the previous year.
    assert [(m.year, m.month) for m in report.history] == [
        (2025, 9), (2025, 10), (2025, 11), (2025, 12), (2026, 1), (2026, 2),
    ]  # fmt: skip
    assert report.history[0].income == Decimal("100.00")
    assert (report.previous.month, report.previous.expense) == (1, Decimal("800.00"))

    assert [(s.name, s.total) for s in report.spending] == [
        ("Mercado", Decimal("450.00")),
        ("Sem categoria", Decimal("50.00")),
    ]
    assert [(s.name, s.total) for s in report.income_by_category] == [
        ("Salário", Decimal("3000.00"))
    ]
    assert report.budget is not None
    assert report.budget.spent == Decimal("450.00")

    descriptions = [(t.description, t.category, t.budget_item) for t in report.transactions]
    assert descriptions == [
        ("x", "Salário", None),
        ("Feira <grande> & cia", "Mercado", "Casa"),
        ("x", "Sem categoria", None),
    ]
    # Movements use the reader's month, not the UTC one.
    assert [m.reason for m in report.movements] == ["fevereiro local"]
    # Balances are as of now and cover every account, in its own currency.
    balances = {a.name: (a.balance, a.currency) for a in report.accounts}
    assert balances == {
        "Nubank": (Decimal("2820.00"), Currency.BRL),
        "Wise": (Decimal("30.00"), Currency.USD),
    }


def test_report_in_another_currency_leaves_brl_out(client: TestClient, db_session: Session) -> None:
    seed(client, db_session)
    report = monthly_report(db_session, 2026, 2, Currency.USD)
    assert (report.income, report.expense) == (Decimal("0.00"), Decimal("20.00"))
    assert report.budget is None
    assert report.movements == []


def test_pdf_shows_the_report(client: TestClient, db_session: Session) -> None:
    seed(client, db_session)
    report = monthly_report(db_session, 2026, 2, Currency.BRL, utc_offset_minutes=-180)
    pdf = render_monthly_report(report, compress=False)

    assert pdf.startswith(b"%PDF")
    for text in (b"Fevereiro de 2026", b"Receitas vs despesas", b"Casa", b"Nubank", b"Wise"):
        assert text in pdf
    # User text is escaped, not read as markup.
    assert b"Feira &lt;grande&gt; &amp; cia" not in pdf
    assert b"(Feira <)" in pdf  # reportlab splits the line into text runs
    assert b"(> & cia)" in pdf


def test_pdf_endpoint(client: TestClient) -> None:
    post(client, "/api/accounts", {"name": "Conta", "initial_balance": "10"})
    response = client.get(
        "/api/reports/monthly-pdf",
        params={"year": 2026, "month": 2, "currency": "BRL", "utc_offset": -180},
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert (
        response.headers["content-disposition"]
        == 'attachment; filename="selfmoney-relatorio-2026-02-BRL.pdf"'
    )
    assert response.content.startswith(b"%PDF")


def test_pdf_endpoint_validates_the_period(client: TestClient) -> None:
    get = client.get
    assert get("/api/reports/monthly-pdf", params={"year": 2026}).status_code == 422
    assert get("/api/reports/monthly-pdf", params={"year": 2026, "month": 13}).status_code == 422
    params = {"year": 2026, "month": 1, "utc_offset": 2000}
    assert get("/api/reports/monthly-pdf", params=params).status_code == 422


def test_money_format_matches_the_frontend() -> None:
    assert money(Decimal("1234.5"), Currency.BRL) == "R$ 1.234,50"
    assert money(Decimal("-1000"), Currency.USD) == "-US$ 1.000,00"
    assert money(Decimal("999.6"), Currency.EUR, cents=False) == "€ 1.000"
