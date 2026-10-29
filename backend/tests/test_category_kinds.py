from fastapi.testclient import TestClient


def post(client: TestClient, path: str, payload: dict, expected: int = 201) -> dict:
    response = client.post(path, json=payload)
    assert response.status_code == expected, response.text
    return response.json()


def transaction(client: TestClient, account_id: int, tx_type: str, category_id: int) -> int:
    payload = {
        "description": "x",
        "amount": "10",
        "type": tx_type,
        "date": "2026-10-01",
        "account_id": account_id,
        "category_id": category_id,
    }
    return client.post("/api/transactions", json=payload).status_code


def test_categories_default_to_expense_and_can_be_income(client: TestClient) -> None:
    assert post(client, "/api/categories", {"name": "Mercado"})["kind"] == "expense"
    assert (
        post(client, "/api/categories", {"name": "Salário", "kind": "income"})["kind"] == "income"
    )
    post(client, "/api/categories", {"name": "Bônus", "kind": "transfer"}, expected=422)


def test_list_filters_by_kind(client: TestClient) -> None:
    post(client, "/api/categories", {"name": "Mercado"})
    post(client, "/api/categories", {"name": "Salário", "kind": "income"})

    def names(**params: object) -> list[str]:
        return [c["name"] for c in client.get("/api/categories", params=params).json()]

    assert names() == ["Mercado", "Salário"]
    assert names(kind="income") == ["Salário"]
    assert names(kind="expense") == ["Mercado"]


def test_transaction_category_must_match_its_type(client: TestClient) -> None:
    account = post(client, "/api/accounts", {"name": "Conta"})
    food = post(client, "/api/categories", {"name": "Mercado"})
    salary = post(client, "/api/categories", {"name": "Salário", "kind": "income"})

    assert transaction(client, account["id"], "expense", food["id"]) == 201
    assert transaction(client, account["id"], "income", salary["id"]) == 201
    assert transaction(client, account["id"], "income", food["id"]) == 422
    assert transaction(client, account["id"], "expense", salary["id"]) == 422


def test_kind_change_is_blocked_by_transactions_of_the_other_type(client: TestClient) -> None:
    account = post(client, "/api/accounts", {"name": "Conta"})
    unused = post(client, "/api/categories", {"name": "Freela"})
    used = post(client, "/api/categories", {"name": "Mercado"})
    transaction(client, account["id"], "expense", used["id"])

    moved = client.patch(f"/api/categories/{unused['id']}", json={"kind": "income"})
    assert moved.status_code == 200
    assert moved.json()["kind"] == "income"

    assert client.patch(f"/api/categories/{used['id']}", json={"kind": "income"}).status_code == 409
    assert client.patch(f"/api/categories/{used['id']}", json={"kind": None}).status_code == 422


def test_color_can_be_changed(client: TestClient) -> None:
    category = post(client, "/api/categories", {"name": "Lazer", "color": "#111111"})
    response = client.patch(f"/api/categories/{category['id']}", json={"color": "#e34948"})
    assert response.json()["color"] == "#e34948"
    assert client.get("/api/categories").json()[0]["color"] == "#e34948"
