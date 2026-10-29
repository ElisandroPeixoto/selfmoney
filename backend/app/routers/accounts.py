from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Account, AccountMovement, CreditCard, Transaction
from app.schemas import AccountCreate, AccountRead, AccountUpdate
from app.services import account_balances, list_accounts_with_balance, to_account_read

router = APIRouter(prefix="/accounts", tags=["accounts"])

NON_NULLABLE_FIELDS = ("name", "currency")


def _ensure_unique_name(db: Session, name: str, exclude_id: int | None = None) -> None:
    query = select(Account.id).where(Account.name == name)
    if exclude_id is not None:
        query = query.where(Account.id != exclude_id)
    if db.scalar(query) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Account name already exists")


@router.get("", response_model=list[AccountRead])
def list_accounts(db: Session = Depends(get_db)) -> list[AccountRead]:
    return list_accounts_with_balance(db)


@router.post("", response_model=AccountRead, status_code=status.HTTP_201_CREATED)
def create_account(payload: AccountCreate, db: Session = Depends(get_db)) -> AccountRead:
    _ensure_unique_name(db, payload.name)
    account = Account(**payload.model_dump())
    db.add(account)
    db.commit()
    return to_account_read(account)


@router.patch("/{account_id}", response_model=AccountRead)
def update_account(
    account_id: int, payload: AccountUpdate, db: Session = Depends(get_db)
) -> AccountRead:
    account = db.get(Account, account_id)
    if account is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")

    changes = payload.model_dump(exclude_unset=True)
    for field in NON_NULLABLE_FIELDS:
        if field in changes and changes[field] is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"'{field}' cannot be null")
    if "name" in changes:
        _ensure_unique_name(db, changes["name"], exclude_id=account_id)

    for field, value in changes.items():
        setattr(account, field, value)
    db.commit()
    return to_account_read(account, account_balances(db).get(account.id, Decimal("0")))


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(account_id: int, db: Session = Depends(get_db)) -> Response:
    account = db.get(Account, account_id)
    if account is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")
    # Explicit because SQLite doesn't enforce ON DELETE CASCADE by default.
    db.execute(delete(Transaction).where(Transaction.account_id == account_id))
    # Movements stay in the log (with the copied account name), just unlinked.
    db.execute(
        update(AccountMovement)
        .where(AccountMovement.from_account_id == account_id)
        .values(from_account_id=None)
    )
    db.execute(
        update(AccountMovement)
        .where(AccountMovement.to_account_id == account_id)
        .values(to_account_id=None)
    )
    # Cards stay, unlinked; without an account they can't export anymore.
    db.execute(
        update(CreditCard)
        .where(CreditCard.account_id == account_id)
        .values(account_id=None, auto_export=False)
    )
    db.delete(account)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
