from datetime import UTC

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import AwareDatetime
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Account, AccountMovement, MovementKind
from app.schemas import DepositCreate, MovementRead, TransferCreate, WithdrawalCreate

router = APIRouter(prefix="/movements", tags=["movements"])


def _get_account(db: Session, account_id: int) -> Account:
    account = db.get(Account, account_id)
    if account is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Account not found")
    return account


def _record(db: Session, movement: AccountMovement) -> AccountMovement:
    db.add(movement)
    db.commit()
    return movement


@router.get("", response_model=list[MovementRead])
def list_movements(
    account_id: int | None = None,
    kind: MovementKind | None = None,
    created_from: AwareDatetime | None = None,
    created_before: AwareDatetime | None = None,
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> list[AccountMovement]:
    """The movements log, newest first. There is no edit or delete: it is append-only.

    `created_from` (inclusive) and `created_before` (exclusive) must carry a timezone, so the
    client can ask for its own local days.
    """
    query = select(AccountMovement)
    if account_id is not None:
        query = query.where(
            or_(
                AccountMovement.from_account_id == account_id,
                AccountMovement.to_account_id == account_id,
            )
        )
    if kind is not None:
        query = query.where(AccountMovement.kind == kind)
    # Stored values are UTC (SQLite keeps them without an offset), so compare in UTC.
    if created_from is not None:
        query = query.where(AccountMovement.created_at >= created_from.astimezone(UTC))
    if created_before is not None:
        query = query.where(AccountMovement.created_at < created_before.astimezone(UTC))
    query = query.order_by(AccountMovement.created_at.desc(), AccountMovement.id.desc())
    return list(db.scalars(query.limit(limit).offset(offset)))


@router.post("/deposit", response_model=MovementRead, status_code=status.HTTP_201_CREATED)
def deposit(payload: DepositCreate, db: Session = Depends(get_db)) -> AccountMovement:
    account = _get_account(db, payload.account_id)
    return _record(
        db,
        AccountMovement(
            kind=MovementKind.DEPOSIT,
            amount=payload.amount,
            currency=account.currency,
            reason=payload.reason,
            to_account_id=account.id,
            to_account_name=account.name,
        ),
    )


@router.post("/withdrawal", response_model=MovementRead, status_code=status.HTTP_201_CREATED)
def withdraw(payload: WithdrawalCreate, db: Session = Depends(get_db)) -> AccountMovement:
    account = _get_account(db, payload.account_id)
    return _record(
        db,
        AccountMovement(
            kind=MovementKind.WITHDRAWAL,
            amount=payload.amount,
            currency=account.currency,
            reason=payload.reason,
            from_account_id=account.id,
            from_account_name=account.name,
        ),
    )


@router.post("/transfer", response_model=MovementRead, status_code=status.HTTP_201_CREATED)
def transfer(payload: TransferCreate, db: Session = Depends(get_db)) -> AccountMovement:
    source = _get_account(db, payload.from_account_id)
    destination = _get_account(db, payload.to_account_id)
    if source.currency != destination.currency:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Transfers between accounts in different currencies are not supported",
        )
    return _record(
        db,
        AccountMovement(
            kind=MovementKind.TRANSFER,
            amount=payload.amount,
            currency=source.currency,
            reason=payload.reason,
            from_account_id=source.id,
            from_account_name=source.name,
            to_account_id=destination.id,
            to_account_name=destination.name,
        ),
    )
