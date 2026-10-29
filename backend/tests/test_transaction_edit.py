from fastapi.testclient import TestClient


def post(client: TestClient, path: str, payload: dict) -> dict:
    response = client.post(path, json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def setup(client: TestClient) -> dict:
    account = post(client, "/api/accounts", {"name": "Conta", "initial_balance": "100"})
    other = post(client, "/api/accounts", {"name": "Outra"})
    food = post(client, "/api/categories", {"name": "Mercado"})
    salary = post(client, "/api/categories", {"name": "Salário", "kind": "income"})
    budget = post(client, "/api/budgets", {"year": 2026, "month": 10})
    budget = post(client, f"/api/budgets/{budget['id']}/items", {"name": "Casa", "planned": "500"})
    tx = post(
        client,
        "/api/transactions",
        {
            "description": "Feira",
            "amount": "40",
            "type": "expense",
            "date": "2026-10-05",
            "account_id": account["id"],
            "category_id": food["id"],
            "budget_item_id": budget["items"][0]["id"],
        },
    )
    return {
        "account": account,
        "other": other,
        "food": food,
        "salary": salary,
        "budget": budget,
        "tx": tx,
    }


def patch(client: TestClient, tx_id: int, changes: dict):
    return client.patch(f"/api/transactions/{tx_id}", json=changes)


def test_edit_description_amount_date_and_account(client: TestClient) -> None:
    data = setup(client)
    response = patch(
        client,
        data["tx"]["id"],
        {
            "description": "Feira da semana",
            "amount": "55.90",
            "date": "2026-10-20",
            "account_id": data["other"]["id"],
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["description"], body["amount"], body["date"]) == (
        "Feira da semana",
        "55.90",
        "2026-10-20",
    )
    assert body["account_id"] == data["other"]["id"]
    # Untouched fields stay as they were.
    assert body["category_id"] == data["food"]["id"]

    balances = {a["name"]: a["balance"] for a in client.get("/api/accounts").json()}
    assert balances == {"Conta": "100.00", "Outra": "-55.90"}


def test_changing_the_type_drops_a_category_of_the_old_type(client: TestClient) -> None:
    data = setup(client)
    body = patch(client, data["tx"]["id"], {"type": "income"}).json()
    assert body["type"] == "income"
    assert body["category_id"] is None
    # Income can't count against a budget either.
    assert body["budget_item_id"] is None


def test_changing_type_and_category_together(client: TestClient) -> None:
    data = setup(client)
    response = patch(
        client, data["tx"]["id"], {"type": "income", "category_id": data["salary"]["id"]}
    )
    assert response.status_code == 200
    assert response.json()["category_id"] == data["salary"]["id"]


def test_moving_to_another_month_unlinks_the_budget(client: TestClient) -> None:
    data = setup(client)
    budget_id = data["budget"]["id"]
    assert client.get(f"/api/budgets/{budget_id}").json()["spent"] == "40.00"

    body = patch(client, data["tx"]["id"], {"date": "2026-11-02"}).json()
    assert body["budget_item_id"] is None
    assert client.get(f"/api/budgets/{budget_id}").json()["spent"] == "0.00"


def test_explicitly_invalid_changes_are_rejected(client: TestClient) -> None:
    data = setup(client)
    tx_id = data["tx"]["id"]
    item_id = data["budget"]["items"][0]["id"]

    assert patch(client, tx_id, {"category_id": data["salary"]["id"]}).status_code == 422
    assert patch(client, tx_id, {"account_id": 999}).status_code == 422
    assert patch(client, tx_id, {"amount": "0"}).status_code == 422
    assert patch(client, tx_id, {"description": None}).status_code == 422
    assert (
        patch(client, tx_id, {"date": "2026-11-01", "budget_item_id": item_id}).status_code == 422
    )
    assert patch(client, 999, {"description": "x"}).status_code == 404

    # Nothing changed.
    tx = client.get("/api/transactions").json()[0]
    assert (tx["amount"], tx["category_id"]) == ("40.00", data["food"]["id"])
