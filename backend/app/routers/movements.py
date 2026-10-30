from datetime import UTC

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import AwareDatetime
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Account, AccountMovement, MovementKind
from app.schemas import (
    DepositCreate,
    MovementRead,
    MovementUpdate,
    TransferCreate,
    WithdrawalCreate,
)

router = APIRouter(prefix="/movements", tags=["movements"])


def _invalid(message: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, message)


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
    """The movements log, newest first.

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


# Account fields each kind has; the others must stay empty.
ACCOUNT_FIELDS = {
    MovementKind.TRANSFER: ("from_account_id", "to_account_id"),
    MovementKind.DEPOSIT: ("to_account_id",),
    MovementKind.WITHDRAWAL: ("from_account_id",),
}


def _get_movement(db: Session, movement_id: int) -> AccountMovement:
    movement = db.get(AccountMovement, movement_id)
    if movement is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Movement not found")
    return movement


@router.patch("/{movement_id}", response_model=MovementRead)
def update_movement(
    movement_id: int, payload: MovementUpdate, db: Session = Depends(get_db)
) -> AccountMovement:
    """Change amount, justification or accounts; the kind and the time stay as recorded."""
    movement = _get_movement(db, movement_id)
    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        if value is None:
            raise _invalid(f"'{field}' cannot be null")
        if field.endswith("_account_id") and field not in ACCOUNT_FIELDS[movement.kind]:
            raise _invalid(f"A {movement.kind.value} has no '{field}'")

    # Changed accounts are validated and their names copied, as when recording.
    accounts: dict[str, Account] = {}
    for side in ("from", "to"):
        account_id = changes.get(f"{side}_account_id")
        if account_id is not None:
            accounts[side] = _get_account(db, account_id)
    from_id = accounts["from"].id if "from" in accounts else movement.from_account_id
    to_id = accounts["to"].id if "to" in accounts else movement.to_account_id
    if movement.kind == MovementKind.TRANSFER:
        if from_id is not None and from_id == to_id:
            raise _invalid("Source and destination accounts must differ")
        currencies = {a.currency for a in accounts.values()}
        if len(accounts) == 1:
            currencies.add(movement.currency)  # the side that didn't change
        if len(currencies) > 1:
            raise _invalid("Transfers between accounts in different currencies are not supported")

    for side, account in accounts.items():
        setattr(movement, f"{side}_account_id", account.id)
        setattr(movement, f"{side}_account_name", account.name)
        movement.currency = account.currency
    if "amount" in changes:
        movement.amount = changes["amount"]
    if "reason" in changes:
        movement.reason = changes["reason"]
    db.commit()
    return movement


@router.delete("/{movement_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_movement(movement_id: int, db: Session = Depends(get_db)) -> Response:
    """Remove a movement; the balances it changed go back to what they were without it."""
    movement = _get_movement(db, movement_id)
    db.delete(movement)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
