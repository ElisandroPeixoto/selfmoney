from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Currency
from app.report_pdf import render_monthly_report
from app.schemas import MonthTotals
from app.services import monthly_report, monthly_totals

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/monthly", response_model=list[MonthTotals])
def get_monthly_totals(
    year: int = Query(ge=2000, le=2100),
    currency: Currency = Currency.BRL,
    db: Session = Depends(get_db),
) -> list[MonthTotals]:
    """Income and expense totals for each of the 12 months of a year."""
    return monthly_totals(db, year, currency)


@router.get(
    "/monthly-pdf",
    response_class=Response,
    responses={200: {"content": {"application/pdf": {}}, "description": "The report as a PDF"}},
)
def get_monthly_report_pdf(
    year: int = Query(ge=2000, le=2100),
    month: int = Query(ge=1, le=12),
    currency: Currency = Currency.BRL,
    utc_offset: int = Query(
        default=0,
        ge=-12 * 60,
        le=14 * 60,
        description="Reader's offset from UTC in minutes (e.g. -180 for Brasília)",
    ),
    db: Session = Depends(get_db),
) -> Response:
    """Monthly report (income, expenses, budget, account balances) as a PDF download."""
    report = monthly_report(db, year, month, currency, utc_offset)
    filename = f"selfmoney-relatorio-{year}-{month:02d}-{currency.value}.pdf"
    return Response(
        render_monthly_report(report),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
