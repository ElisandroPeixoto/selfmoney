from datetime import date

from fastapi.testclient import TestClient


def post(client: TestClient, path: str, payload: dict) -> dict:
    response = client.post(path, json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def add_expense(client: TestClient, account_id: int, amount: str, category_id: int | None = None):
    return post(
        client,
        "/api/transactions",
        {
            "description": "x",
            "amount": amount,
            "type": "expense",
            "date": date.today().isoformat(),
            "account_id": account_id,
            "category_id": category_id,
        },
    )


# Categories


def test_delete_category_keeps_transactions_as_uncategorized(client: TestClient) -> None:
    account = post(client, "/api/accounts", {"name": "Conta"})
    food = post(client, "/api/categories", {"name": "Comida"})
    add_expense(client, account["id"], "30", food["id"])

    assert client.delete(f"/api/categories/{food['id']}").status_code == 204

    assert client.get("/api/categories").json() == []
    assert client.get("/api/transactions").json()[0]["category_id"] is None
    spending = client.get("/api/dashboard/summary").json()["spending_by_category"]
    assert [s["name"] for s in spending] == ["Sem categoria"]


def test_delete_missing_category_returns_404(client: TestClient) -> None:
    assert client.delete("/api/categories/999").status_code == 404


# Accounts


def test_account_defaults_to_brl_without_bank(client: TestClient) -> None:
    account = post(client, "/api/accounts", {"name": "Conta"})
    assert (account["currency"], account["bank"]) == ("BRL", None)


def test_update_account_name_currency_and_bank(client: TestClient) -> None:
    account = post(client, "/api/accounts", {"name": "Conta", "initial_balance": "100"})
    add_expense(client, account["id"], "40")

    response = client.patch(
        f"/api/accounts/{account['id']}",
        json={"name": "Nubank PJ", "currency": "USD", "bank": "nubank"},
    )

    assert response.status_code == 200
    body = response.json()
    assert (body["name"], body["currency"], body["bank"]) == ("Nubank PJ", "USD", "nubank")
    assert body["balance"] == "60.00"


def test_partial_update_keeps_other_fields(client: TestClient) -> None:
    account = post(client, "/api/accounts", {"name": "Conta", "bank": "itau"})
    body = client.patch(f"/api/accounts/{account['id']}", json={"currency": "EUR"}).json()
    assert (body["name"], body["currency"], body["bank"]) == ("Conta", "EUR", "itau")


def test_bank_can_be_cleared(client: TestClient) -> None:
    account = post(client, "/api/accounts", {"name": "Conta", "bank": "itau"})
    body = client.patch(f"/api/accounts/{account['id']}", json={"bank": None}).json()
    assert body["bank"] is None


def test_update_rejects_unknown_bank_and_currency(client: TestClient) -> None:
    account = post(client, "/api/accounts", {"name": "Conta"})
    url = f"/api/accounts/{account['id']}"
    assert client.patch(url, json={"bank": "caixa"}).status_code == 422
    assert client.patch(url, json={"currency": "JPY"}).status_code == 422
    assert client.patch(url, json={"name": None}).status_code == 422


def test_rename_to_existing_name_conflicts(client: TestClient) -> None:
    post(client, "/api/accounts", {"name": "A"})
    b = post(client, "/api/accounts", {"name": "B"})
    assert client.patch(f"/api/accounts/{b['id']}", json={"name": "A"}).status_code == 409
    # Keeping its own name is fine.
    assert client.patch(f"/api/accounts/{b['id']}", json={"name": "B"}).status_code == 200


def test_update_missing_account_returns_404(client: TestClient) -> None:
    assert client.patch("/api/accounts/999", json={"name": "X"}).status_code == 404


# Dashboard with multiple currencies


def test_dashboard_separates_currencies(client: TestClient) -> None:
    brl = post(client, "/api/accounts", {"name": "BR", "initial_balance": "1000"})
    usd = post(client, "/api/accounts", {"name": "US", "initial_balance": "500", "currency": "USD"})
    add_expense(client, brl["id"], "100")
    add_expense(client, usd["id"], "20")

    summary = client.get("/api/dashboard/summary").json()
    assert summary["balances_by_currency"] == [
        {"currency": "BRL", "total": "900.00"},
        {"currency": "USD", "total": "480.00"},
    ]
    assert (summary["currency"], summary["month_expenses"]) == ("BRL", "100.00")

    usd_summary = client.get("/api/dashboard/summary", params={"currency": "USD"}).json()
    assert usd_summary["month_expenses"] == "20.00"
