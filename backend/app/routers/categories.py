from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import CardPurchase, Category, Transaction, TransactionType
from app.schemas import CategoryCreate, CategoryRead, CategoryUpdate

router = APIRouter(prefix="/categories", tags=["categories"])


@router.get("", response_model=list[CategoryRead])
def list_categories(
    kind: TransactionType | None = None, db: Session = Depends(get_db)
) -> list[Category]:
    query = select(Category).order_by(Category.name)
    if kind is not None:
        query = query.where(Category.kind == kind)
    return list(db.scalars(query))


def _ensure_unique_name(db: Session, name: str, exclude_id: int | None = None) -> None:
    query = select(Category.id).where(Category.name == name)
    if exclude_id is not None:
        query = query.where(Category.id != exclude_id)
    if db.scalar(query) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Category name already exists")


@router.post("", response_model=CategoryRead, status_code=status.HTTP_201_CREATED)
def create_category(payload: CategoryCreate, db: Session = Depends(get_db)) -> Category:
    _ensure_unique_name(db, payload.name)
    category = Category(**payload.model_dump())
    db.add(category)
    db.commit()
    return category


@router.patch("/{category_id}", response_model=CategoryRead)
def update_category(
    category_id: int, payload: CategoryUpdate, db: Session = Depends(get_db)
) -> Category:
    category = db.get(Category, category_id)
    if category is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Category not found")

    changes = payload.model_dump(exclude_unset=True)
    for field in ("name", "color", "kind"):
        if field in changes and changes[field] is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"'{field}' cannot be null")
    if "name" in changes:
        _ensure_unique_name(db, changes["name"], exclude_id=category_id)
    if "kind" in changes and changes["kind"] != category.kind:
        mismatched = db.scalar(
            select(Transaction.id)
            .where(Transaction.category_id == category_id, Transaction.type != changes["kind"])
            .limit(1)
        )
        if mismatched is not None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Category is used by transactions of the other type",
            )
        # Card purchases are always expenses.
        on_card = db.scalar(
            select(CardPurchase.id).where(CardPurchase.category_id == category_id).limit(1)
        )
        if on_card is not None and changes["kind"] != TransactionType.EXPENSE:
            raise HTTPException(
                status.HTTP_409_CONFLICT, "Category is used by credit card purchases"
            )

    for field, value in changes.items():
        setattr(category, field, value)
    db.commit()
    return category


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(category_id: int, db: Session = Depends(get_db)) -> Response:
    category = db.get(Category, category_id)
    if category is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Category not found")
    # Done explicitly because SQLite doesn't enforce ON DELETE SET NULL by default.
    db.execute(
        update(Transaction).where(Transaction.category_id == category_id).values(category_id=None)
    )
    db.execute(
        update(CardPurchase).where(CardPurchase.category_id == category_id).values(category_id=None)
    )
    db.delete(category)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
