from functools import lru_cache
from pathlib import Path

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
SQLITE_PREFIX = "sqlite:///"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    app_env: str = "development"
    database_url: str = "sqlite:///./selfmoney.db"
    cors_origins: str = "http://localhost:5173"
    auto_create_tables: bool = True
    # Empty password = no login (development). Production refuses to start without one.
    app_password: str = ""
    secret_key: str = ""
    session_days: int = 30

    @field_validator("database_url")
    @classmethod
    def normalize_database_url(cls, value: str) -> str:
        # Supabase hands out plain postgres:// URIs; SQLAlchemy needs an explicit driver.
        for prefix in ("postgres://", "postgresql://"):
            if value.startswith(prefix):
                return "postgresql+psycopg://" + value.removeprefix(prefix)
        # Anchor relative SQLite paths to backend/ so the DB file is the same from any cwd.
        if value.startswith(SQLITE_PREFIX):
            path = Path(value.removeprefix(SQLITE_PREFIX))
            if path.as_posix() != ":memory:" and not path.is_absolute():
                return SQLITE_PREFIX + (BACKEND_DIR / path).resolve().as_posix()
        return value

    @model_validator(mode="after")
    def require_password_in_production(self) -> "Settings":
        if self.app_env == "production" and (not self.app_password or not self.secret_key):
            raise ValueError(
                "APP_PASSWORD and SECRET_KEY must be set when APP_ENV=production: "
                "the app has no other access control"
            )
        return self

    @property
    def auth_required(self) -> bool:
        return bool(self.app_password)

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
