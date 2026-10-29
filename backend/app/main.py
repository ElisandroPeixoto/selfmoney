from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import models  # noqa: F401  (registers tables on Base.metadata)
from app.config import get_settings
from app.database import Base, engine
from app.routers import (
    accounts,
    auth,
    budgets,
    cards,
    categories,
    dashboard,
    movements,
    reports,
    transactions,
)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    if get_settings().auto_create_tables:
        Base.metadata.create_all(bind=engine)
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="SelfMoney API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_methods=["*"],
        allow_headers=["*"],
        # Cross-origin JS can only read this header if exposed (it names the PDF download).
        expose_headers=["Content-Disposition"],
    )

    @app.get("/api/health", tags=["health"])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(auth.router, prefix="/api")
    protected = (accounts, categories, transactions, dashboard, reports, budgets, movements, cards)
    for module in protected:
        app.include_router(module.router, prefix="/api", dependencies=[Depends(auth.require_auth)])
    return app


app = create_app()
