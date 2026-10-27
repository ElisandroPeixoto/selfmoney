from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Currency
from app.schemas import DashboardSummary
from app.services import dashboard_summary

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/summary", response_model=DashboardSummary)
def get_summary(
    year: int | None = Query(default=None, ge=2000, le=2100),
    month: int | None = Query(default=None, ge=1, le=12),
    currency: Currency = Currency.BRL,
    db: Session = Depends(get_db),
) -> DashboardSummary:
    today = date.today()
    return dashboard_summary(db, year or today.year, month or today.month, currency)
