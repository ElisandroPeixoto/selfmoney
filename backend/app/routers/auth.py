import asyncio

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.auth import InvalidTokenError, create_token, password_matches, verify_token
from app.config import Settings, get_settings
from app.schemas import AuthStatus, LoginRequest, LoginResponse

router = APIRouter(prefix="/auth", tags=["auth"])

bearer = HTTPBearer(auto_error=False)

# Slows down password guessing; the real defense is a long random password.
FAILED_LOGIN_DELAY_SECONDS = 1.0


def _is_authenticated(settings: Settings, credentials: HTTPAuthorizationCredentials | None) -> bool:
    if not settings.auth_required:
        return True
    if credentials is None:
        return False
    try:
        verify_token(settings, credentials.credentials)
    except InvalidTokenError:
        return False
    return True


def require_auth(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    settings: Settings = Depends(get_settings),
) -> None:
    """Dependency for every protected router."""
    if not _is_authenticated(settings, credentials):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )


@router.get("/status", response_model=AuthStatus)
def auth_status(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    settings: Settings = Depends(get_settings),
) -> AuthStatus:
    return AuthStatus(
        auth_required=settings.auth_required,
        authenticated=_is_authenticated(settings, credentials),
    )


@router.post("/login", response_model=LoginResponse)
async def login(payload: LoginRequest, settings: Settings = Depends(get_settings)) -> LoginResponse:
    if not settings.auth_required:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No password is configured")
    if not password_matches(settings, payload.password):
        await asyncio.sleep(FAILED_LOGIN_DELAY_SECONDS)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong password")
    token, expires_at = create_token(settings)
    return LoginResponse(token=token, expires_at=expires_at)
