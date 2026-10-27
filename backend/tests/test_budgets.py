from fastapi.testclient import TestClient


def post(client: TestClient, path: str, payload: dict, expected: int = 201) -> dict:
    response = client.post(path, json=payload)
    assert response.status_code == expected, response.text
    return response.json()


def make_budget(client: TestClient, year: int = 2026, month: int = 10, **extra) -> dict:
    return post(client, "/api/budgets", {"year": year, "month": month, **extra})


def add_item(client: TestClient, budget_id: int, name: str, planned: str) -> dict:
    return post(client, f"/api/budgets/{budget_id}/items", {"name": name, "planned": planned})


def expense(client: TestClient, account_id: int, amount: str, day: str, **extra) -> dict:
    payload = {
        "description": "x",
        "amount": amount,
        "type": "expense",
        "date": day,
        "account_id": account_id,
        **extra,
    }
    return post(client, "/api/transactions", payload)


def item_named(budget: dict, name: str) -> dict:
    return next(i for i in budget["items"] if i["name"] == name)


def test_create_budget_for_a_month(client: TestClient) -> None:
    budget = make_budget(client)
    assert (budget["year"], budget["month"], budget["currency"]) == (2026, 10, "BRL")
    assert budget["items"] == []
    assert budget["planned"] == "0.00"


def test_only_one_budget_per_month(client: TestClient) -> None:
    make_budget(client)
    post(client, "/api/budgets", {"year": 2026, "month": 10}, expected=409)
    make_budget(client, month=11)
    assert [b["month"] for b in client.get("/api/budgets").json()] == [11, 10]


def test_items_track_planned_spent_and_available(client: TestClient) -> None:
    account = post(client, "/api/accounts", {"name": "Conta"})
    budget = make_budget(client)
    add_item(client, budget["id"], "Cartão de crédito", "1000")
    budget = add_item(client, budget["id"], "Assinaturas", "100")
    card = item_named(budget, "Cartão de crédito")["id"]
    subs = item_named(budget, "Assinaturas")["id"]

    expense(client, account["id"], "300", "2026-10-05", budget_item_id=card)
    expense(client, account["id"], "120", "2026-10-06", budget_item_id=subs)
    # Not linked: doesn't count against the budget.
    expense(client, account["id"], "999", "2026-10-07")

    budget = client.get(f"/api/budgets/{budget['id']}").json()
    assert item_named(budget, "Cartão de crédito") == {
        "id": card,
        "name": "Cartão de crédito",
        "planned": "1000.00",
        "spent": "300.00",
        "available": "700.00",
    }
    assert item_named(budget, "Assinaturas")["available"] == "-20.00"
    assert (budget["planned"], budget["spent"], budget["available"]) == (
        "1100.00",
        "420.00",
        "680.00",
    )


def test_link_existing_expense_and_unlink(client: TestClient) -> None:
    account = post(client, "/api/accounts", {"name": "Conta"})
    budget = add_item(client, make_budget(client)["id"], "Taxas", "50")
    item_id = budget["items"][0]["id"]
    tx = expense(client, account["id"], "20", "2026-10-10")

    linked = client.patch(f"/api/transactions/{tx['id']}", json={"budget_item_id": item_id})
    assert linked.status_code == 200
    assert linked.json()["budget_item_id"] == item_id
    assert client.get(f"/api/budgets/{budget['id']}").json()["spent"] == "20.00"

    client.patch(f"/api/transactions/{tx['id']}", json={"budget_item_id": None})
    assert client.get(f"/api/budgets/{budget['id']}").json()["spent"] == "0.00"


def test_link_rules(client: TestClient) -> None:
    brl = post(client, "/api/accounts", {"name": "BRL"})
    usd = post(client, "/api/accounts", {"name": "USD", "currency": "USD"})
    item_id = add_item(client, make_budget(client)["id"], "Taxas", "50")["items"][0]["id"]

    def link(**fields: object) -> int:
        payload = {
            "description": "x",
            "amount": "1",
            "type": "expense",
            "date": "2026-10-01",
            "account_id": brl["id"],
            "budget_item_id": item_id,
            **fields,
        }
        return client.post("/api/transactions", json=payload).status_code

    assert link() == 201
    assert link(date="2026-11-01") == 422  # other month
    assert link(type="income") == 422
    assert link(account_id=usd["id"]) == 422  # other currency
    assert link(budget_item_id=999) == 422


def test_item_rename_limit_and_delete(client: TestClient) -> None:
    account = post(client, "/api/accounts", {"name": "Conta"})
    budget = make_budget(client)
    add_item(client, budget["id"], "A", "10")
    budget = add_item(client, budget["id"], "B", "20")
    a, b = (item_named(budget, n)["id"] for n in ("A", "B"))
    tx = expense(client, account["id"], "5", "2026-10-01", budget_item_id=b)
    url = f"/api/budgets/{budget['id']}/items"

    assert client.post(url, json={"name": "A", "planned": "1"}).status_code == 409
    assert client.patch(f"{url}/{b}", json={"name": "A"}).status_code == 409
    assert client.patch(f"{url}/{b}", json={"planned": "-1"}).status_code == 422

    updated = client.patch(f"{url}/{b}", json={"name": "Streaming", "planned": "35.5"}).json()
    assert item_named(updated, "Streaming")["available"] == "30.50"

    after_delete = client.delete(f"{url}/{b}").json()
    assert [i["id"] for i in after_delete["items"]] == [a]
    assert client.get("/api/transactions").json()[0]["id"] == tx["id"]
    assert client.get("/api/transactions").json()[0]["budget_item_id"] is None


def test_delete_budget_keeps_expenses_unlinked(client: TestClient) -> None:
    account = post(client, "/api/accounts", {"name": "Conta"})
    budget = add_item(client, make_budget(client)["id"], "Taxas", "50")
    expense(client, account["id"], "5", "2026-10-01", budget_item_id=budget["items"][0]["id"])

    assert client.delete(f"/api/budgets/{budget['id']}").status_code == 204
    assert client.get("/api/budgets").json() == []
    assert client.get("/api/transactions").json()[0]["budget_item_id"] is None
    assert client.delete(f"/api/budgets/{budget['id']}").status_code == 404


def test_save_template_and_reuse_in_another_month(client: TestClient) -> None:
    budget = make_budget(client)
    add_item(client, budget["id"], "Cartão de crédito", "1500")
    add_item(client, budget["id"], "Assinaturas", "80")

    template = post(client, f"/api/budgets/{budget['id']}/save-template", {"name": "Padrão"})
    assert [(i["name"], i["planned"]) for i in template["items"]] == [
        ("Cartão de crédito", "1500.00"),
        ("Assinaturas", "80.00"),
    ]
    post(client, f"/api/budgets/{budget['id']}/save-template", {"name": "Padrão"}, expected=409)

    november = make_budget(client, month=11, template_id=template["id"])
    assert [(i["name"], i["planned"], i["spent"]) for i in november["items"]] == [
        ("Cartão de crédito", "1500.00", "0.00"),
        ("Assinaturas", "80.00", "0.00"),
    ]

    assert [t["name"] for t in client.get("/api/budget-templates").json()] == ["Padrão"]
    assert client.delete(f"/api/budget-templates/{template['id']}").status_code == 204
    assert client.get("/api/budget-templates").json() == []


def test_copy_structure_from_another_budget(client: TestClient) -> None:
    october = add_item(client, make_budget(client)["id"], "Taxas", "40")
    december = make_budget(client, month=12, source_budget_id=october["id"])
    assert [(i["name"], i["planned"]) for i in december["items"]] == [("Taxas", "40.00")]


def test_create_budget_validates_sources(client: TestClient) -> None:
    payload = {"year": 2026, "month": 1}
    post(client, "/api/budgets", {**payload, "template_id": 9}, expected=422)
    post(client, "/api/budgets", {**payload, "source_budget_id": 9}, expected=422)
    both = {**payload, "template_id": 1, "source_budget_id": 1}
    post(client, "/api/budgets", both, expected=422)
    post(client, "/api/budgets", {"year": 2026, "month": 13}, expected=422)
