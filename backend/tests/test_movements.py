from datetime import UTC, date, datetime

from fastapi.testclient import TestClient
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.models import AccountMovement


def post(client: TestClient, path: str, payload: dict, expected: int = 201) -> dict:
    response = client.post(path, json=payload)
    assert response.status_code == expected, response.text
    return response.json()


def account(client: TestClient, name: str, initial: str = "0", **extra) -> dict:
    return post(client, "/api/accounts", {"name": name, "initial_balance": initial, **extra})


def balances(client: TestClient) -> dict[str, str]:
    return {a["name"]: a["balance"] for a in client.get("/api/accounts").json()}


def test_deposit_and_withdrawal_change_the_balance(client: TestClient) -> None:
    acc = account(client, "Conta", "100")
    deposit = post(
        client,
        "/api/movements/deposit",
        {"account_id": acc["id"], "amount": "50.25", "reason": "Presente de aniversário"},
    )
    assert deposit["kind"] == "deposit"
    assert (deposit["to_account_name"], deposit["from_account_id"]) == ("Conta", None)

    post(
        client,
        "/api/movements/withdrawal",
        {"account_id": acc["id"], "amount": "20", "reason": "Saque no caixa"},
    )
    assert balances(client) == {"Conta": "130.25"}


def test_transfer_moves_money_between_accounts(client: TestClient) -> None:
    a = account(client, "A", "500")
    b = account(client, "B", "10")
    moved = post(
        client,
        "/api/movements/transfer",
        {
            "from_account_id": a["id"],
            "to_account_id": b["id"],
            "amount": "200",
            "reason": "Reserva",
        },
    )
    assert (moved["from_account_name"], moved["to_account_name"]) == ("A", "B")
    assert moved["currency"] == "BRL"
    assert balances(client) == {"A": "300.00", "B": "210.00"}


def test_movements_require_a_justification(client: TestClient) -> None:
    acc = account(client, "Conta")
    base = {"account_id": acc["id"], "amount": "10"}
    post(client, "/api/movements/deposit", base, expected=422)
    post(client, "/api/movements/deposit", {**base, "reason": "   "}, expected=422)
    post(client, "/api/movements/withdrawal", {**base, "reason": "ok"}, expected=422)
    stored = post(client, "/api/movements/deposit", {**base, "reason": "  Reembolso  "})
    assert stored["reason"] == "Reembolso"


def test_movement_validation(client: TestClient) -> None:
    brl = account(client, "BRL")
    usd = account(client, "USD", currency="USD")
    reason = {"reason": "Motivo"}

    def transfer(src: int, dst: int, amount: str = "1") -> None:
        payload = {"from_account_id": src, "to_account_id": dst, "amount": amount, **reason}
        post(client, "/api/movements/transfer", payload, expected=422)

    transfer(brl["id"], brl["id"])  # same account
    transfer(brl["id"], usd["id"])  # different currencies
    transfer(brl["id"], 999)  # unknown account
    transfer(brl["id"], usd["id"], amount="0")
    post(
        client,
        "/api/movements/deposit",
        {"account_id": brl["id"], "amount": "-5", **reason},
        expected=422,
    )
    assert client.get("/api/movements").json() == []


def test_log_lists_newest_first_and_filters(client: TestClient) -> None:
    a = account(client, "A", "100")
    b = account(client, "B")
    c = account(client, "C")
    post(
        client,
        "/api/movements/deposit",
        {"account_id": a["id"], "amount": "1", "reason": "primeiro"},
    )
    post(
        client,
        "/api/movements/transfer",
        {"from_account_id": a["id"], "to_account_id": b["id"], "amount": "2", "reason": "segundo"},
    )
    post(
        client,
        "/api/movements/withdrawal",
        {"account_id": c["id"], "amount": "3", "reason": "terceiro"},
    )

    log = client.get("/api/movements").json()
    assert [m["reason"] for m in log] == ["terceiro", "segundo", "primeiro"]
    assert log[0]["created_at"].endswith("+00:00")

    def reasons(**params: object) -> list[str]:
        return [m["reason"] for m in client.get("/api/movements", params=params).json()]

    assert reasons(account_id=b["id"]) == ["segundo"]
    assert reasons(account_id=a["id"]) == ["segundo", "primeiro"]
    assert reasons(kind="withdrawal") == ["terceiro"]


def test_log_filters_by_date_range(client: TestClient, db_session: Session) -> None:
    acc = account(client, "Conta", "100")
    times = {
        "fim de março": datetime(2026, 3, 31, 23, 30, tzinfo=UTC),
        "abril": datetime(2026, 4, 10, 12, 0, tzinfo=UTC),
        "maio": datetime(2026, 5, 2, 9, 0, tzinfo=UTC),
    }
    for reason, created_at in times.items():
        moved = post(
            client,
            "/api/movements/deposit",
            {"account_id": acc["id"], "amount": "1", "reason": reason},
        )
        db_session.execute(
            update(AccountMovement)
            .where(AccountMovement.id == moved["id"])
            .values(created_at=created_at)
        )
    db_session.commit()

    def reasons(**params: str) -> list[str]:
        response = client.get("/api/movements", params=params)
        assert response.status_code == 200, response.text
        return [m["reason"] for m in response.json()]

    assert reasons(created_from="2026-04-01T00:00:00+00:00") == ["maio", "abril"]
    assert reasons(created_before="2026-05-01T00:00:00+00:00") == ["abril", "fim de março"]
    assert reasons(
        created_from="2026-04-01T00:00:00+00:00", created_before="2026-05-01T00:00:00+00:00"
    ) == ["abril"]
    # 23:30 UTC on 31/03 is still March 31 in UTC, but already April 1 at UTC+1.
    assert reasons(
        created_from="2026-04-01T00:00:00+01:00", created_before="2026-04-02T00:00:00+01:00"
    ) == ["fim de março"]


def test_log_date_filter_needs_a_timezone(client: TestClient) -> None:
    response = client.get("/api/movements", params={"created_from": "2026-04-01T00:00:00"})
    assert response.status_code == 422


def test_log_survives_account_deletion(client: TestClient) -> None:
    a = account(client, "Antiga", "100")
    b = account(client, "Nova")
    post(
        client,
        "/api/movements/transfer",
        {
            "from_account_id": a["id"],
            "to_account_id": b["id"],
            "amount": "40",
            "reason": "Fechando",
        },
    )
    assert client.delete(f"/api/accounts/{a['id']}").status_code == 204

    entry = client.get("/api/movements").json()[0]
    assert (entry["from_account_id"], entry["from_account_name"]) == (None, "Antiga")
    assert balances(client) == {"Nova": "40.00"}


def test_movements_stay_out_of_monthly_records(client: TestClient) -> None:
    acc = account(client, "Conta")
    post(
        client, "/api/movements/deposit", {"account_id": acc["id"], "amount": "99", "reason": "x y"}
    )

    year = date.today().year
    report = client.get("/api/reports/monthly", params={"year": year}).json()
    assert all(m["income"] == "0.00" for m in report)
    assert client.get("/api/transactions").json() == []
    summary = client.get("/api/dashboard/summary").json()
    assert summary["balances_by_currency"] == [{"currency": "BRL", "total": "99.00"}]
    assert summary["month_expenses"] == "0.00"
