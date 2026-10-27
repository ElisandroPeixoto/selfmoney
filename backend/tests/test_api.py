from datetime import date

from fastapi.testclient import TestClient

from app.config import BACKEND_DIR, SQLITE_PREFIX, Settings


def create_account(client: TestClient, name: str = "Corrente", initial: str = "100.00") -> dict:
    response = client.post("/api/accounts", json={"name": name, "initial_balance": initial})
    assert response.status_code == 201
    return response.json()


def create_category(client: TestClient, name: str, color: str = "#112233") -> dict:
    response = client.post("/api/categories", json={"name": name, "color": color})
    assert response.status_code == 201
    return response.json()


def create_transaction(client: TestClient, **fields: object) -> dict:
    payload = {"description": "x", "date": date.today().isoformat(), **fields}
    response = client.post("/api/transactions", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def test_health(client: TestClient) -> None:
    assert client.get("/api/health").json() == {"status": "ok"}


def test_create_account_starts_with_initial_balance(client: TestClient) -> None:
    account = create_account(client, initial="250.50")
    assert account["balance"] == "250.50"


def test_duplicate_account_name_is_rejected(client: TestClient) -> None:
    create_account(client, name="Dup")
    response = client.post("/api/accounts", json={"name": "Dup"})
    assert response.status_code == 409


def test_balance_reflects_income_and_expenses(client: TestClient) -> None:
    account = create_account(client, initial="100.00")
    create_transaction(client, amount="50.00", type="income", account_id=account["id"])
    create_transaction(client, amount="30.25", type="expense", account_id=account["id"])

    accounts = client.get("/api/accounts").json()
    assert accounts[0]["balance"] == "119.75"


def test_transaction_requires_existing_account(client: TestClient) -> None:
    response = client.post(
        "/api/transactions",
        json={
            "description": "x",
            "amount": "10",
            "type": "expense",
            "date": "2026-01-01",
            "account_id": 999,
        },
    )
    assert response.status_code == 422


def test_transaction_amount_must_be_positive(client: TestClient) -> None:
    account = create_account(client)
    response = client.post(
        "/api/transactions",
        json={
            "description": "x",
            "amount": "-5",
            "type": "expense",
            "date": "2026-01-01",
            "account_id": account["id"],
        },
    )
    assert response.status_code == 422


def test_category_color_is_validated(client: TestClient) -> None:
    response = client.post("/api/categories", json={"name": "Bad", "color": "red"})
    assert response.status_code == 422


def test_dashboard_groups_month_expenses_by_category(client: TestClient) -> None:
    account = create_account(client, initial="1000.00")
    food = create_category(client, "Alimentação")
    home = create_category(client, "Moradia")
    acc_id = account["id"]

    create_transaction(
        client, amount="40", type="expense", account_id=acc_id, category_id=food["id"]
    )
    create_transaction(
        client, amount="60", type="expense", account_id=acc_id, category_id=food["id"]
    )
    create_transaction(
        client, amount="500", type="expense", account_id=acc_id, category_id=home["id"]
    )
    create_transaction(client, amount="25", type="expense", account_id=acc_id)
    create_transaction(client, amount="3000", type="income", account_id=acc_id)
    # Previous month: must not be counted in this month's chart.
    create_transaction(client, amount="999", type="expense", account_id=acc_id, date="2000-01-15")

    today = date.today()
    summary = client.get(
        "/api/dashboard/summary", params={"year": today.year, "month": today.month}
    ).json()

    spending = {item["name"]: item["total"] for item in summary["spending_by_category"]}
    assert spending == {"Moradia": "500.00", "Alimentação": "100.00", "Sem categoria": "25.00"}
    assert summary["spending_by_category"][0]["name"] == "Moradia"
    assert summary["month_expenses"] == "625.00"
    assert summary["balances_by_currency"] == [{"currency": "BRL", "total": "2376.00"}]


def test_dashboard_defaults_to_current_month(client: TestClient) -> None:
    summary = client.get("/api/dashboard/summary").json()
    today = date.today()
    assert (summary["year"], summary["month"]) == (today.year, today.month)
    assert summary["balances_by_currency"] == []
    assert summary["spending_by_category"] == []


def test_dashboard_rejects_invalid_month(client: TestClient) -> None:
    assert client.get("/api/dashboard/summary", params={"month": 13}).status_code == 422


def test_supabase_url_gets_psycopg_driver() -> None:
    settings = Settings(database_url="postgresql://user:pw@host:6543/postgres")
    assert settings.database_url == "postgresql+psycopg://user:pw@host:6543/postgres"


def test_relative_sqlite_path_is_anchored_to_backend_dir() -> None:
    settings = Settings(database_url="sqlite:///./dev.db")
    assert settings.database_url == SQLITE_PREFIX + (BACKEND_DIR / "dev.db").resolve().as_posix()
