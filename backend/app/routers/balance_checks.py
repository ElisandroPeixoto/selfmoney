from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import BalanceCheck
from app.schemas import BalanceCheckRead

router = APIRouter(prefix="/balance-checks", tags=["balance-checks"])


@router.get("", response_model=list[BalanceCheckRead])
def list_balance_checks(db: Session = Depends(get_db)) -> list[BalanceCheck]:
    return list(db.scalars(select(BalanceCheck).order_by(BalanceCheck.created_at.desc())))


@router.post("", response_model=BalanceCheckRead, status_code=status.HTTP_201_CREATED)
def record_balance_check(db: Session = Depends(get_db)) -> BalanceCheck:
    check = BalanceCheck()
    db.add(check)
    db.commit()
    return check


@router.delete("/{check_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_balance_check(check_id: int, db: Session = Depends(get_db)) -> Response:
    check = db.get(BalanceCheck, check_id)
    if check is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Balance check not found")
    db.delete(check)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
