from datetime import date

from fastapi.testclient import TestClient


def post(client: TestClient, path: str, payload: dict) -> dict:
    response = client.post(path, json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def add_tx(client: TestClient, account_id: int, amount: str, tx_type: str, day: str, **extra):
    return post(
        client,
        "/api/transactions",
        {
            "description": "x",
            "amount": amount,
            "type": tx_type,
            "date": day,
            "account_id": account_id,
            **extra,
        },
    )


# Accounts


def test_delete_account_removes_its_transactions(client: TestClient) -> None:
    keep = post(client, "/api/accounts", {"name": "Fica"})
    gone = post(client, "/api/accounts", {"name": "Sai"})
    add_tx(client, keep["id"], "10", "expense", "2026-03-01")
    add_tx(client, gone["id"], "20", "expense", "2026-03-01")

    assert client.delete(f"/api/accounts/{gone['id']}").status_code == 204

    assert [a["name"] for a in client.get("/api/accounts").json()] == ["Fica"]
    remaining = client.get("/api/transactions").json()
    assert [t["account_id"] for t in remaining] == [keep["id"]]


def test_delete_missing_account_returns_404(client: TestClient) -> None:
    assert client.delete("/api/accounts/999").status_code == 404


def test_create_account_with_bank_and_currency(client: TestClient) -> None:
    body = post(
        client,
        "/api/accounts",
        {"name": "BB", "initial_balance": "50.10", "bank": "banco_do_brasil", "currency": "EUR"},
    )
    assert (body["bank"], body["currency"], body["balance"]) == ("banco_do_brasil", "EUR", "50.10")


# Category icons


def test_category_icon_can_be_set_changed_and_cleared(client: TestClient) -> None:
    cat = post(client, "/api/categories", {"name": "Pet", "icon": "🐶"})
    assert cat["icon"] == "🐶"

    url = f"/api/categories/{cat['id']}"
    assert client.patch(url, json={"icon": "🐱"}).json()["icon"] == "🐱"
    body = client.patch(url, json={"icon": None}).json()
    assert body["icon"] is None
    assert body["name"] == "Pet"


def test_category_update_validates(client: TestClient) -> None:
    post(client, "/api/categories", {"name": "A"})
    b = post(client, "/api/categories", {"name": "B"})
    url = f"/api/categories/{b['id']}"
    assert client.patch(url, json={"name": "A"}).status_code == 409
    assert client.patch(url, json={"color": "blue"}).status_code == 422
    assert client.patch(url, json={"icon": ""}).status_code == 422
    assert client.patch("/api/categories/999", json={"name": "X"}).status_code == 404


def test_dashboard_spending_includes_category_icon(client: TestClient) -> None:
    account = post(client, "/api/accounts", {"name": "Conta"})
    cat = post(client, "/api/categories", {"name": "Pet", "icon": "🐶"})
    add_tx(client, account["id"], "5", "expense", date.today().isoformat(), category_id=cat["id"])
    spending = client.get("/api/dashboard/summary").json()["spending_by_category"]
    assert spending[0]["icon"] == "🐶"


# Transactions by period


def test_list_transactions_filters_by_year_and_month(client: TestClient) -> None:
    account = post(client, "/api/accounts", {"name": "Conta"})
    add_tx(client, account["id"], "1", "expense", "2026-01-31")
    add_tx(client, account["id"], "2", "income", "2026-02-01")
    add_tx(client, account["id"], "3", "expense", "2026-02-28")
    add_tx(client, account["id"], "4", "expense", "2025-02-15")

    def amounts(**params: object) -> list[str]:
        return [t["amount"] for t in client.get("/api/transactions", params=params).json()]

    assert amounts(year=2026, month=2) == ["3.00", "2.00"]
    assert amounts(year=2026) == ["3.00", "2.00", "1.00"]
    assert len(amounts()) == 4
    assert client.get("/api/transactions", params={"month": 2}).status_code == 422


def test_list_transactions_filters_by_currency(client: TestClient) -> None:
    brl = post(client, "/api/accounts", {"name": "BR"})
    usd = post(client, "/api/accounts", {"name": "US", "currency": "USD"})
    add_tx(client, brl["id"], "1", "expense", "2026-01-01")
    add_tx(client, usd["id"], "2", "expense", "2026-01-01")

    body = client.get("/api/transactions", params={"currency": "USD"}).json()
    assert [t["account_id"] for t in body] == [usd["id"]]


def test_delete_transaction(client: TestClient) -> None:
    account = post(client, "/api/accounts", {"name": "Conta", "initial_balance": "10"})
    tx = add_tx(client, account["id"], "4", "expense", "2026-01-01")

    assert client.delete(f"/api/transactions/{tx['id']}").status_code == 204
    assert client.get("/api/transactions").json() == []
    assert client.get("/api/accounts").json()[0]["balance"] == "10.00"
    assert client.delete(f"/api/transactions/{tx['id']}").status_code == 404


def test_monthly_report_has_twelve_months_with_totals(client: TestClient) -> None:
    account = post(client, "/api/accounts", {"name": "Conta"})
    usd = post(client, "/api/accounts", {"name": "US", "currency": "USD"})
    add_tx(client, account["id"], "100", "income", "2026-03-05")
    add_tx(client, account["id"], "30", "expense", "2026-03-10")
    add_tx(client, account["id"], "20.50", "expense", "2026-03-20")
    add_tx(client, account["id"], "7", "expense", "2026-12-31")
    add_tx(client, account["id"], "999", "expense", "2025-03-10")
    add_tx(client, usd["id"], "999", "expense", "2026-03-10")

    report = client.get("/api/reports/monthly", params={"year": 2026}).json()

    assert [m["month"] for m in report] == list(range(1, 13))
    assert report[2] == {"month": 3, "income": "100.00", "expense": "50.50"}
    assert report[11] == {"month": 12, "income": "0.00", "expense": "7.00"}
    assert report[0] == {"month": 1, "income": "0.00", "expense": "0.00"}


def test_monthly_report_requires_year(client: TestClient) -> None:
    assert client.get("/api/reports/monthly").status_code == 422
