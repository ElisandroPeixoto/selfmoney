"""Single-password access: a correct password buys a signed, expiring session token."""

import base64
import hashlib
import hmac
from datetime import UTC, datetime, timedelta

from app.config import Settings


class InvalidTokenError(ValueError):
    """The token is malformed, forged, expired or from before a password change."""


def _signing_key(settings: Settings) -> bytes:
    # Mixing in the password means changing it signs everyone out.
    secret = settings.secret_key or "selfmoney-dev"
    return hmac.new(secret.encode(), settings.app_password.encode(), hashlib.sha256).digest()


def _sign(settings: Settings, payload: str) -> str:
    digest = hmac.new(_signing_key(settings), payload.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def password_matches(settings: Settings, password: str) -> bool:
    return hmac.compare_digest(password.encode(), settings.app_password.encode())


def create_token(settings: Settings, now: datetime | None = None) -> tuple[str, datetime]:
    expires_at = (now or datetime.now(UTC)) + timedelta(hours=settings.session_hours)
    payload = str(int(expires_at.timestamp()))
    return f"{payload}.{_sign(settings, payload)}", expires_at


def verify_token(settings: Settings, token: str, now: datetime | None = None) -> None:
    payload, _, signature = token.partition(".")
    if not payload.isdigit() or not hmac.compare_digest(signature, _sign(settings, payload)):
        raise InvalidTokenError("Invalid token")
    if int(payload) <= (now or datetime.now(UTC)).timestamp():
        raise InvalidTokenError("Expired token")
