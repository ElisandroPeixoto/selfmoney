from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.auth import InvalidTokenError, create_token, verify_token
from app.config import Settings, get_settings
from app.database import get_db
from app.main import create_app
from app.routers import auth

PASSWORD = "correct horse battery staple"


def settings(**extra: object) -> Settings:
    values = {"app_env": "development", "app_password": PASSWORD, "secret_key": "k" * 32}
    return Settings(_env_file=None, **{**values, **extra})


@pytest.fixture
def locked(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setattr(auth, "FAILED_LOGIN_DELAY_SECONDS", 0)
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db_session
    # A lambda: FastAPI would read settings()'s **extra as query parameters.
    app.dependency_overrides[get_settings] = lambda: settings()
    with TestClient(app) as test_client:
        yield test_client


def login(client: TestClient, password: str = PASSWORD) -> dict[str, str]:
    response = client.post("/api/auth/login", json={"password": password})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['token']}"}


def test_without_a_password_everything_is_open(client: TestClient) -> None:
    assert client.get("/api/auth/status").json() == {
        "auth_required": False,
        "authenticated": True,
    }
    assert client.get("/api/accounts").status_code == 200
    assert client.post("/api/auth/login", json={"password": "x"}).status_code == 400


def test_password_locks_every_route_but_health(locked: TestClient) -> None:
    for path in ("/api/accounts", "/api/dashboard/summary", "/api/movements", "/api/budgets"):
        response = locked.get(path)
        assert response.status_code == 401, path
        assert response.headers["www-authenticate"] == "Bearer"
    assert locked.post("/api/accounts", json={"name": "X"}).status_code == 401
    assert (
        locked.get("/api/reports/monthly-pdf", params={"year": 2026, "month": 1}).status_code == 401
    )
    assert locked.get("/api/health").status_code == 200
    assert locked.get("/api/auth/status").json() == {
        "auth_required": True,
        "authenticated": False,
    }


def test_login_gives_a_token_that_opens_the_api(locked: TestClient) -> None:
    assert locked.post("/api/auth/login", json={"password": "wrong"}).status_code == 401

    headers = login(locked)
    assert locked.get("/api/accounts", headers=headers).status_code == 200
    assert locked.post("/api/accounts", json={"name": "X"}, headers=headers).status_code == 201
    assert locked.get("/api/auth/status", headers=headers).json()["authenticated"] is True

    tampered = {"Authorization": headers["Authorization"][:-2] + "xx"}
    assert locked.get("/api/accounts", headers=tampered).status_code == 401
    assert locked.get("/api/accounts", headers={"Authorization": "Bearer junk"}).status_code == 401


def test_tokens_expire_and_die_with_a_password_change() -> None:
    now = datetime(2026, 1, 1, tzinfo=UTC)
    token, expires_at = create_token(settings(), now)
    assert expires_at == now + timedelta(hours=24)

    verify_token(settings(), token, now + timedelta(hours=23))
    with pytest.raises(InvalidTokenError):
        verify_token(settings(), token, now + timedelta(hours=25))
    with pytest.raises(InvalidTokenError):
        verify_token(settings(app_password="a new password"), token, now)
    with pytest.raises(InvalidTokenError):
        verify_token(settings(secret_key="another secret"), token, now)


def test_production_refuses_to_start_without_password_and_secret() -> None:
    with pytest.raises(ValidationError, match="APP_PASSWORD and SECRET_KEY"):
        settings(app_env="production", app_password="")
    with pytest.raises(ValidationError, match="APP_PASSWORD and SECRET_KEY"):
        settings(app_env="production", secret_key="")
    assert settings(app_env="production").auth_required


def test_browsers_may_send_the_token_cross_origin(locked: TestClient) -> None:
    origin = get_settings().cors_origin_list[0]
    preflight = locked.options(
        "/api/accounts",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        },
    )
    assert preflight.status_code == 200
    assert "authorization" in preflight.headers["access-control-allow-headers"].lower()
