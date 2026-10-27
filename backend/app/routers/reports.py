from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Currency
from app.schemas import MonthTotals
from app.services import monthly_totals

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/monthly", response_model=list[MonthTotals])
def get_monthly_totals(
    year: int = Query(ge=2000, le=2100),
    currency: Currency = Currency.BRL,
    db: Session = Depends(get_db),
) -> list[MonthTotals]:
    """Income and expense totals for each of the 12 months of a year."""
    return monthly_totals(db, year, currency)
