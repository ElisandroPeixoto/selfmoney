from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Account, Category, Currency, Transaction
from app.schemas import TransactionCreate, TransactionRead, TransactionUpdate
from app.services import BudgetLinkError, check_budget_link, period_bounds

router = APIRouter(prefix="/transactions", tags=["transactions"])


@router.get("", response_model=list[TransactionRead])
def list_transactions(
    year: int | None = Query(default=None, ge=2000, le=2100),
    month: int | None = Query(default=None, ge=1, le=12),
    currency: Currency | None = None,
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> list[Transaction]:
    if month is not None and year is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "'month' requires 'year'")

    query = select(Transaction)
    if year is not None:
        first_day, last_day = period_bounds(year, month)
        query = query.where(Transaction.date.between(first_day, last_day))
    if currency is not None:
        query = query.join(Account, Transaction.account_id == Account.id).where(
            Account.currency == currency
        )
    query = (
        query.order_by(Transaction.date.desc(), Transaction.id.desc()).limit(limit).offset(offset)
    )
    return list(db.scalars(query))


def _check_budget_link(db: Session, item_id: int, tx: Transaction | TransactionCreate) -> None:
    account = db.get(Account, tx.account_id)
    assert account is not None
    try:
        check_budget_link(db, item_id, tx.type, tx.date, account)
    except BudgetLinkError as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(error)) from error


@router.post("", response_model=TransactionRead, status_code=status.HTTP_201_CREATED)
def create_transaction(payload: TransactionCreate, db: Session = Depends(get_db)) -> Transaction:
    if db.get(Account, payload.account_id) is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Account not found")
    if payload.category_id is not None and db.get(Category, payload.category_id) is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Category not found")
    if payload.budget_item_id is not None:
        _check_budget_link(db, payload.budget_item_id, payload)
    transaction = Transaction(**payload.model_dump())
    db.add(transaction)
    db.commit()
    return transaction


@router.patch("/{transaction_id}", response_model=TransactionRead)
def update_transaction(
    transaction_id: int, payload: TransactionUpdate, db: Session = Depends(get_db)
) -> Transaction:
    transaction = db.get(Transaction, transaction_id)
    if transaction is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Transaction not found")
    if payload.budget_item_id is not None:
        _check_budget_link(db, payload.budget_item_id, transaction)
    transaction.budget_item_id = payload.budget_item_id
    db.commit()
    return transaction


@router.delete("/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction(transaction_id: int, db: Session = Depends(get_db)) -> Response:
    transaction = db.get(Transaction, transaction_id)
    if transaction is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Transaction not found")
    db.delete(transaction)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
