from decimal import Decimal

from fastapi.testclient import TestClient

from app.services import installment_amounts


def post(client: TestClient, path: str, payload: dict, expected: int = 201) -> dict:
    response = client.post(path, json=payload)
    assert response.status_code == expected, response.text
    return response.json()


def setup(client: TestClient, **card: object) -> dict:
    account = post(client, "/api/accounts", {"name": "Nubank", "initial_balance": "1000"})
    category = post(client, "/api/categories", {"name": "Casa"})
    created = post(client, "/api/cards", {"name": "Roxinho", "account_id": account["id"], **card})
    return {"account": account, "category": category, "card": created}


def purchase(client: TestClient, card_id: int, expected: int = 201, **extra: object) -> dict:
    payload = {"description": "Sofá", "amount": "1000", "date": "2026-10-20", **extra}
    return post(client, f"/api/cards/{card_id}/purchases", payload, expected)


def export(client: TestClient, card_id: int, *purchase_ids: int, expected: int = 200) -> dict:
    payload = {"purchase_ids": list(purchase_ids)}
    return post(client, f"/api/cards/{card_id}/purchases/export", payload, expected)


def bills(client: TestClient, card_id: int, year: int, month: int, months: int = 12) -> list:
    params = {"year": year, "month": month, "months": months}
    response = client.get(f"/api/cards/{card_id}/bills", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def test_installments_keep_the_total() -> None:
    assert installment_amounts(Decimal("1000"), 3) == [
        Decimal("333.34"),
        Decimal("333.33"),
        Decimal("333.33"),
    ]
    cents = installment_amounts(Decimal("0.05"), 3)
    assert cents == [Decimal("0.03"), Decimal("0.01"), Decimal("0.01")]
    assert sum(installment_amounts(Decimal("99.99"), 7)) == Decimal("99.99")


def test_card_takes_the_account_currency(client: TestClient) -> None:
    usd = post(client, "/api/accounts", {"name": "Wise", "currency": "USD"})
    card = post(client, "/api/cards", {"name": "Visa", "account_id": usd["id"], "currency": "BRL"})
    assert (card["currency"], card["account_name"]) == ("USD", "Wise")

    loose = post(client, "/api/cards", {"name": "Solto", "currency": "EUR"})
    assert (loose["currency"], loose["account_id"]) == ("EUR", None)

    post(client, "/api/cards", {"name": "Visa"}, expected=409)
    post(client, "/api/cards", {"name": "X", "account_id": 999}, expected=422)
    post(client, "/api/cards", {"name": "Z", "due_day": 32}, expected=422)


def test_purchase_installments_fill_the_following_bills(client: TestClient) -> None:
    ids = setup(client)
    card_id = ids["card"]["id"]
    sofa = purchase(client, card_id, installments=3, category_id=ids["category"]["id"])
    # Defaults to the bill after the purchase month.
    assert (sofa["first_year"], sofa["first_month"]) == (2026, 11)
    assert sofa["installment_amount"] == "333.33"
    purchase(client, card_id, description="Café", amount="12.50", first_year=2026, first_month=12)

    months = bills(client, card_id, 2026, 10, months=5)
    assert [(b["month"], b["total"]) for b in months] == [
        (10, "0.00"),
        (11, "333.34"),
        (12, "345.83"),
        (1, "333.33"),
        (2, "0.00"),
    ]
    december = months[2]["installments"]
    assert [(i["description"], i["number"], i["installments"]) for i in december] == [
        ("Sofá", 2, 3),
        ("Café", 1, 1),
    ]
    assert client.get("/api/cards").json()[0]["pending_total"] == "1012.50"


def test_purchase_validation(client: TestClient) -> None:
    ids = setup(client)
    card_id = ids["card"]["id"]
    salary = post(client, "/api/categories", {"name": "Salário", "kind": "income"})
    purchase(client, card_id, category_id=salary["id"], expected=422)
    purchase(client, card_id, installments=0, expected=422)
    purchase(client, card_id, installments=49, expected=422)
    purchase(client, card_id, first_year=2026, expected=422)
    purchase(client, 999, expected=404)


def test_export_bill_to_transactions(client: TestClient) -> None:
    ids = setup(client, due_day=31)
    card_id, account_id = ids["card"]["id"], ids["account"]["id"]
    category_id = ids["category"]["id"]
    purchase(client, card_id, installments=2, category_id=category_id)

    result = post(client, f"/api/cards/{card_id}/bills/2026/11/export", {}, expected=200)
    assert result["created"] == 1
    assert result["bill"]["pending_total"] == "0.00"
    assert result["bill"]["installments"][0]["transaction_id"] is not None

    transactions = client.get("/api/transactions", params={"year": 2026}).json()
    assert [
        (t["description"], t["amount"], t["date"], t["account_id"], t["category_id"], t["type"])
        for t in transactions
    ] == [("Sofá (1/2)", "500.00", "2026-11-30", account_id, category_id, "expense")]

    # Exporting again creates nothing new.
    again = post(client, f"/api/cards/{card_id}/bills/2026/11/export", {}, expected=200)
    assert again["created"] == 0
    assert client.get("/api/cards").json()[0]["pending_total"] == "500.00"
    assert client.get(f"/api/cards/{card_id}/purchases").json()[0]["exported_installments"] == 1

    # Deleting the expense makes the installment pending again.
    client.delete(f"/api/transactions/{transactions[0]['id']}")
    assert bills(client, card_id, 2026, 11, 1)[0]["pending_total"] == "500.00"


def test_export_needs_an_account(client: TestClient) -> None:
    card = post(client, "/api/cards", {"name": "Solto"})
    purchase(client, card["id"])
    post(client, f"/api/cards/{card['id']}/bills/2026/11/export", {}, expected=409)
    post(client, f"/api/cards/{card['id']}/bills/2026/13/export", {}, expected=422)


def test_export_purchases_adds_every_pending_installment(client: TestClient) -> None:
    ids = setup(client)
    card_id = ids["card"]["id"]
    sofa = purchase(client, card_id, installments=3, date="2026-10-31")
    mesa = purchase(client, card_id, description="Mesa", date="2026-10-05")
    assert client.get("/api/cards").json()[0]["pending_total"] == "2000.00"

    result = export(client, card_id, sofa["id"])
    assert result["created"] == 3
    assert [(p["id"], p["exported_installments"]) for p in result["purchases"]] == [(sofa["id"], 3)]

    rows = client.get("/api/transactions", params={"year": 2027}).json()
    rows += client.get("/api/transactions", params={"year": 2026}).json()
    # Without a due day, the purchase day is used (clamped to short months).
    assert sorted((t["date"], t["description"]) for t in rows) == [
        ("2026-11-30", "Sofá (1/3)"),
        ("2026-12-31", "Sofá (2/3)"),
        ("2027-01-31", "Sofá (3/3)"),
    ]
    assert client.get("/api/cards").json()[0]["pending_total"] == "1000.00"
    assert client.get("/api/accounts").json()[0]["balance"] == "0.00"

    # Sending again only exports what is still pending.
    assert export(client, card_id, sofa["id"], mesa["id"])["created"] == 1
    assert client.get("/api/cards").json()[0]["pending_total"] == "0.00"


def test_export_purchases_validates(client: TestClient) -> None:
    ids = setup(client)
    card_id = ids["card"]["id"]
    other = post(client, "/api/cards", {"name": "Outro", "account_id": ids["account"]["id"]})
    foreign = purchase(client, other["id"])
    mine = purchase(client, card_id)

    export(client, card_id, mine["id"], foreign["id"], expected=422)
    export(client, card_id, 999, expected=422)
    post(client, f"/api/cards/{card_id}/purchases/export", {"purchase_ids": []}, expected=422)
    export(client, 999, mine["id"], expected=404)
    assert client.get("/api/transactions", params={"year": 2026}).json() == []

    loose = post(client, "/api/cards", {"name": "Solto"})
    unlinked = purchase(client, loose["id"])
    export(client, loose["id"], unlinked["id"], expected=409)


def test_update_purchase(client: TestClient) -> None:
    ids = setup(client)
    card_id = ids["card"]["id"]
    sofa = purchase(client, card_id, installments=2)
    url = f"/api/cards/{card_id}/purchases/{sofa['id']}"

    updated = client.patch(
        url,
        json={
            "description": "Sofá novo",
            "amount": "1200",
            "installments": 4,
            "date": "2026-10-25",
            "first_year": 2026,
            "first_month": 12,
            "category_id": ids["category"]["id"],
        },
    ).json()
    assert (updated["description"], updated["amount"], updated["installments"]) == (
        "Sofá novo",
        "1200.00",
        4,
    )
    assert (updated["first_year"], updated["first_month"]) == (2026, 12)
    assert updated["category_id"] == ids["category"]["id"]
    assert updated["installment_amount"] == "300.00"
    assert [b["total"] for b in bills(client, card_id, 2026, 11, 3)] == ["0.00", "300.00", "300.00"]

    cleared = client.patch(url, json={"category_id": None}).json()
    assert cleared["category_id"] is None

    income = post(client, "/api/categories", {"name": "Salário", "kind": "income"})
    assert client.patch(url, json={"category_id": income["id"]}).status_code == 422
    assert client.patch(url, json={"category_id": 999}).status_code == 422
    for body in (
        {"description": None},
        {"amount": None},
        {"amount": "0"},
        {"installments": 0},
        {"first_year": 2026},
        {"first_year": None, "first_month": None},
    ):
        assert client.patch(url, json=body).status_code == 422, body
    assert (
        client.patch(f"/api/cards/{card_id}/purchases/999", json={"description": "x"}).status_code
        == 404
    )
    assert (
        client.patch(
            f"/api/cards/999/purchases/{sofa['id']}", json={"description": "x"}
        ).status_code
        == 404
    )


def test_exported_purchase_keeps_its_amounts(client: TestClient) -> None:
    ids = setup(client)
    card_id = ids["card"]["id"]
    sofa = purchase(client, card_id, installments=2)
    url = f"/api/cards/{card_id}/purchases/{sofa['id']}"
    export(client, card_id, sofa["id"])

    for body in (
        {"amount": "500"},
        {"installments": 3},
        {"date": "2026-10-21"},
        {"first_month": 5, "first_year": 2027},
    ):
        assert client.patch(url, json=body).status_code == 409, body
    # Unchanged values and the label fields are still editable.
    same = {"amount": "1000", "installments": 2, "date": "2026-10-20"}
    assert client.patch(url, json=same).status_code == 200
    renamed = client.patch(
        url, json={"description": "Sofá cama", "category_id": ids["category"]["id"]}
    )
    assert renamed.json()["description"] == "Sofá cama"
    assert renamed.json()["category_id"] == ids["category"]["id"]


def test_update_card(client: TestClient) -> None:
    ids = setup(client)
    card_id = ids["card"]["id"]
    usd = post(client, "/api/accounts", {"name": "Wise", "currency": "USD"})

    response = client.patch(f"/api/cards/{card_id}", json={"account_id": usd["id"]})
    assert response.json()["currency"] == "USD"
    response = client.patch(f"/api/cards/{card_id}", json={"account_id": None})
    assert (response.json()["account_id"], response.json()["currency"]) == (None, "USD")
    response = client.patch(f"/api/cards/{card_id}", json={"name": None})
    assert response.status_code == 422


def test_deleting_keeps_exported_transactions(client: TestClient) -> None:
    ids = setup(client)
    card_id = ids["card"]["id"]
    sofa = purchase(client, card_id, installments=2)
    mesa = purchase(client, card_id, description="Mesa")
    export(client, card_id, sofa["id"], mesa["id"])

    response = client.delete(f"/api/cards/{card_id}/purchases/{sofa['id']}")
    assert response.status_code == 204
    assert len(client.get(f"/api/cards/{card_id}/purchases").json()) == 1
    assert client.delete(f"/api/cards/999/purchases/{sofa['id']}").status_code == 404

    assert client.delete(f"/api/cards/{card_id}").status_code == 204
    assert client.get("/api/cards").json() == []
    rows = client.get("/api/transactions", params={"year": 2026}).json()
    assert sorted(t["description"] for t in rows) == ["Mesa", "Sofá (1/2)", "Sofá (2/2)"]


def test_deleting_the_account_or_category_unlinks_the_card(client: TestClient) -> None:
    ids = setup(client)
    card_id = ids["card"]["id"]
    bought = purchase(client, card_id, category_id=ids["category"]["id"])
    export(client, card_id, bought["id"])

    # Card purchases are expenses, so their category can't turn into an income one.
    response = client.patch(f"/api/categories/{ids['category']['id']}", json={"kind": "income"})
    assert response.status_code == 409

    client.delete(f"/api/categories/{ids['category']['id']}")
    assert client.get(f"/api/cards/{card_id}/purchases").json()[0]["category_id"] is None

    client.delete(f"/api/accounts/{ids['account']['id']}")
    card = client.get("/api/cards").json()[0]
    assert card["account_id"] is None
    # Its exported expenses went with the account, so the installment is pending again.
    assert card["pending_total"] == "1000.00"
