from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Account, CardPurchase, Category, CreditCard, Transaction, TransactionType
from app.schemas import (
    CardBillRead,
    CardExportResult,
    CardPurchaseCreate,
    CardPurchaseExport,
    CardPurchaseRead,
    CardPurchasesExportResult,
    CardPurchaseUpdate,
    CreditCardCreate,
    CreditCardRead,
    CreditCardUpdate,
)
from app.services import (
    CardExportError,
    card_bills,
    card_read,
    default_first_bill,
    export_card_installments,
    purchase_reads,
)

router = APIRouter(prefix="/cards", tags=["cards"])

NON_NULLABLE_FIELDS = ("name", "currency")
PURCHASE_NON_NULLABLE_FIELDS = ("description", "amount", "installments", "date")
# Exported expenses keep the amount and dates they were created with.
PURCHASE_LOCKED_FIELDS = ("amount", "installments", "date", "first_year", "first_month")


def _invalid(message: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, message)


def _get_card(db: Session, card_id: int) -> CreditCard:
    card = db.get(CreditCard, card_id)
    if card is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Card not found")
    return card


def _get_purchase(db: Session, card_id: int, purchase_id: int) -> CardPurchase:
    purchase = db.get(CardPurchase, purchase_id)
    if purchase is None or purchase.card_id != card_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Purchase not found")
    return purchase


def _check_category(db: Session, category_id: int | None) -> None:
    if category_id is None:
        return
    category = db.get(Category, category_id)
    if category is None:
        raise _invalid("Category not found")
    if category.kind != TransactionType.EXPENSE:
        raise _invalid("Card purchases need an expense category")


def _ensure_unique_name(db: Session, name: str, exclude_id: int | None = None) -> None:
    query = select(CreditCard.id).where(CreditCard.name == name)
    if exclude_id is not None:
        query = query.where(CreditCard.id != exclude_id)
    if db.scalar(query) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Card name already exists")


def _apply_account(db: Session, card: CreditCard) -> None:
    """Validate the linked account and take its currency."""
    if card.account_id is not None:
        account = db.get(Account, card.account_id)
        if account is None:
            raise _invalid("Account not found")
        card.currency = account.currency


def _unlink_transactions(db: Session, purchase_ids: list[int]) -> None:
    # Exported expenses stay in the transactions; they just stop pointing at the purchase.
    db.execute(
        update(Transaction)
        .where(Transaction.card_purchase_id.in_(purchase_ids))
        .values(card_purchase_id=None, card_installment=None)
    )


@router.get("", response_model=list[CreditCardRead])
def list_cards(db: Session = Depends(get_db)) -> list[CreditCardRead]:
    cards = db.scalars(select(CreditCard).order_by(CreditCard.name))
    return [card_read(db, card) for card in cards]


@router.post("", response_model=CreditCardRead, status_code=status.HTTP_201_CREATED)
def create_card(payload: CreditCardCreate, db: Session = Depends(get_db)) -> CreditCardRead:
    _ensure_unique_name(db, payload.name)
    card = CreditCard(**payload.model_dump())
    _apply_account(db, card)
    db.add(card)
    db.commit()
    return card_read(db, card)


@router.patch("/{card_id}", response_model=CreditCardRead)
def update_card(
    card_id: int, payload: CreditCardUpdate, db: Session = Depends(get_db)
) -> CreditCardRead:
    card = _get_card(db, card_id)
    changes = payload.model_dump(exclude_unset=True)
    for field in NON_NULLABLE_FIELDS:
        if field in changes and changes[field] is None:
            raise _invalid(f"'{field}' cannot be null")
    if "name" in changes:
        _ensure_unique_name(db, changes["name"], exclude_id=card_id)

    for field, value in changes.items():
        setattr(card, field, value)
    try:
        _apply_account(db, card)
    except HTTPException:
        db.rollback()
        raise
    db.commit()
    db.refresh(card)
    return card_read(db, card)


@router.delete("/{card_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_card(card_id: int, db: Session = Depends(get_db)) -> Response:
    card = _get_card(db, card_id)
    _unlink_transactions(db, [p.id for p in card.purchases])
    db.delete(card)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# Purchases


@router.get("/{card_id}/purchases", response_model=list[CardPurchaseRead])
def list_purchases(card_id: int, db: Session = Depends(get_db)) -> list[CardPurchaseRead]:
    _get_card(db, card_id)
    query = (
        select(CardPurchase)
        .where(CardPurchase.card_id == card_id)
        .order_by(CardPurchase.date.desc(), CardPurchase.id.desc())
    )
    return purchase_reads(db, list(db.scalars(query)))


@router.post(
    "/{card_id}/purchases", response_model=CardPurchaseRead, status_code=status.HTTP_201_CREATED
)
def create_purchase(
    card_id: int, payload: CardPurchaseCreate, db: Session = Depends(get_db)
) -> CardPurchaseRead:
    card = _get_card(db, card_id)
    _check_category(db, payload.category_id)

    data = payload.model_dump()
    if data["first_year"] is None:
        data["first_year"], data["first_month"] = default_first_bill(payload.date)
    purchase = CardPurchase(card_id=card.id, **data)
    db.add(purchase)
    db.commit()
    return purchase_reads(db, [purchase])[0]


@router.patch("/{card_id}/purchases/{purchase_id}", response_model=CardPurchaseRead)
def update_purchase(
    card_id: int, purchase_id: int, payload: CardPurchaseUpdate, db: Session = Depends(get_db)
) -> CardPurchaseRead:
    purchase = _get_purchase(db, card_id, purchase_id)
    changes = payload.model_dump(exclude_unset=True)
    for field in PURCHASE_NON_NULLABLE_FIELDS:
        if field in changes and changes[field] is None:
            raise _invalid(f"'{field}' cannot be null")
    if ("first_year" in changes) != ("first_month" in changes):
        raise _invalid("Send both first_year and first_month")
    if "first_year" in changes and None in (changes["first_year"], changes["first_month"]):
        raise _invalid("'first_year' and 'first_month' cannot be null")
    if changes.get("category_id") is not None:
        _check_category(db, changes["category_id"])

    locked = [
        f for f in PURCHASE_LOCKED_FIELDS if f in changes and changes[f] != getattr(purchase, f)
    ]
    if locked and purchase_reads(db, [purchase])[0].exported_installments > 0:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Installments were already exported; only the description and category can change",
        )

    for field, value in changes.items():
        setattr(purchase, field, value)
    db.commit()
    return purchase_reads(db, [purchase])[0]


@router.post("/{card_id}/purchases/export", response_model=CardPurchasesExportResult)
def export_purchases(
    card_id: int, payload: CardPurchaseExport, db: Session = Depends(get_db)
) -> CardPurchasesExportResult:
    """Export every pending installment of the given purchases."""
    card = _get_card(db, card_id)
    ids = list(dict.fromkeys(payload.purchase_ids))
    found = list(
        db.scalars(
            select(CardPurchase)
            .where(CardPurchase.card_id == card_id, CardPurchase.id.in_(ids))
            .order_by(CardPurchase.date.desc(), CardPurchase.id.desc())
        )
    )
    if len(found) != len(ids):
        raise _invalid("Purchase not found")
    try:
        created = export_card_installments(db, card, purchase_ids=ids)
    except CardExportError as error:
        raise HTTPException(status.HTTP_409_CONFLICT, str(error)) from error
    db.commit()
    return CardPurchasesExportResult(created=created, purchases=purchase_reads(db, found))


@router.delete("/{card_id}/purchases/{purchase_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_purchase(card_id: int, purchase_id: int, db: Session = Depends(get_db)) -> Response:
    purchase = _get_purchase(db, card_id, purchase_id)
    _unlink_transactions(db, [purchase_id])
    db.delete(purchase)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# Bills


@router.get("/{card_id}/bills", response_model=list[CardBillRead])
def list_bills(
    card_id: int,
    year: int = Query(ge=2000, le=2100),
    month: int = Query(ge=1, le=12),
    months: int = Query(default=12, ge=1, le=36),
    db: Session = Depends(get_db),
) -> list[CardBillRead]:
    return card_bills(db, _get_card(db, card_id), year, month, months)


@router.post("/{card_id}/bills/{year}/{month}/export", response_model=CardExportResult)
def export_bill(
    card_id: int, year: int, month: int, db: Session = Depends(get_db)
) -> CardExportResult:
    if not (2000 <= year <= 2100 and 1 <= month <= 12):
        raise _invalid("Invalid bill month")
    card = _get_card(db, card_id)
    try:
        created = export_card_installments(db, card, bill=(year, month))
    except CardExportError as error:
        raise HTTPException(status.HTTP_409_CONFLICT, str(error)) from error
    db.commit()
    return CardExportResult(created=created, bill=card_bills(db, card, year, month)[0])
