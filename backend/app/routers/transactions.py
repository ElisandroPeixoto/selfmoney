from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Account, Category, Currency, Transaction
from app.schemas import TransactionCreate, TransactionRead, TransactionUpdate
from app.services import BudgetLinkError, check_budget_link, period_bounds

# Fields a transaction must always have; PATCH may change them but not clear them.
REQUIRED_FIELDS = ("description", "amount", "type", "date", "account_id")

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


def _invalid(message: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, message)


def _category_error(db: Session, data: TransactionCreate) -> str | None:
    if data.category_id is None:
        return None
    category = db.get(Category, data.category_id)
    if category is None:
        return "Category not found"
    if category.kind != data.type:
        return "Category kind doesn't match the transaction type"
    return None


def _budget_error(db: Session, data: TransactionCreate, account: Account) -> str | None:
    if data.budget_item_id is None:
        return None
    try:
        check_budget_link(db, data.budget_item_id, data.type, data.date, account)
    except BudgetLinkError as error:
        return str(error)
    return None


def _validate(db: Session, data: TransactionCreate) -> None:
    account = db.get(Account, data.account_id)
    if account is None:
        raise _invalid("Account not found")
    for error in (_category_error(db, data), _budget_error(db, data, account)):
        if error:
            raise _invalid(error)


@router.post("", response_model=TransactionRead, status_code=status.HTTP_201_CREATED)
def create_transaction(payload: TransactionCreate, db: Session = Depends(get_db)) -> Transaction:
    _validate(db, payload)
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

    changes = payload.model_dump(exclude_unset=True)
    for field in REQUIRED_FIELDS:
        if field in changes and changes[field] is None:
            raise _invalid(f"'{field}' cannot be null")
    current = TransactionRead.model_validate(transaction).model_dump(exclude={"id"})
    merged = TransactionCreate.model_validate({**current, **changes})

    # A category or budget link that only became invalid because of other changes (e.g. the
    # type or month changed) is dropped; one sent explicitly in this request must be valid.
    account = db.get(Account, merged.account_id)
    if account is not None:
        if "category_id" not in changes and _category_error(db, merged):
            merged.category_id = None
        if "budget_item_id" not in changes and _budget_error(db, merged, account):
            merged.budget_item_id = None
    _validate(db, merged)

    for field, value in merged.model_dump().items():
        setattr(transaction, field, value)
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
