from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import CollectionItem, SpendingCollection
from app.schemas import (
    CollectionCreate,
    CollectionItemCreate,
    CollectionRead,
    CollectionUpdate,
)
from app.services import collection_read

router = APIRouter(prefix="/spending-collections", tags=["spending-collections"])


def _get_collection(db: Session, collection_id: int) -> SpendingCollection:
    collection = db.get(SpendingCollection, collection_id)
    if collection is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Collection not found")
    return collection


def _ensure_unique_name(db: Session, name: str, exclude_id: int | None = None) -> None:
    query = select(SpendingCollection.id).where(SpendingCollection.name == name)
    if exclude_id is not None:
        query = query.where(SpendingCollection.id != exclude_id)
    if db.scalar(query) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Collection name already exists")


@router.get("", response_model=list[CollectionRead])
def list_collections(db: Session = Depends(get_db)) -> list[CollectionRead]:
    collections = db.scalars(select(SpendingCollection).order_by(SpendingCollection.name))
    return [collection_read(c) for c in collections]


@router.post("", response_model=CollectionRead, status_code=status.HTTP_201_CREATED)
def create_collection(payload: CollectionCreate, db: Session = Depends(get_db)) -> CollectionRead:
    _ensure_unique_name(db, payload.name)
    collection = SpendingCollection(name=payload.name, currency=payload.currency)
    db.add(collection)
    db.commit()
    return collection_read(collection)


@router.patch("/{collection_id}", response_model=CollectionRead)
def update_collection(
    collection_id: int, payload: CollectionUpdate, db: Session = Depends(get_db)
) -> CollectionRead:
    collection = _get_collection(db, collection_id)
    changes = payload.model_dump(exclude_unset=True)
    for field in ("name", "currency"):
        if field in changes and changes[field] is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"'{field}' cannot be null")
    if "name" in changes:
        _ensure_unique_name(db, changes["name"], exclude_id=collection_id)
    for field, value in changes.items():
        setattr(collection, field, value)
    db.commit()
    return collection_read(collection)


@router.delete("/{collection_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_collection(collection_id: int, db: Session = Depends(get_db)) -> Response:
    db.delete(_get_collection(db, collection_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{collection_id}/items", response_model=CollectionRead, status_code=status.HTTP_201_CREATED
)
def add_item(
    collection_id: int, payload: CollectionItemCreate, db: Session = Depends(get_db)
) -> CollectionRead:
    collection = _get_collection(db, collection_id)
    collection.items.append(CollectionItem(name=payload.name, amount=payload.amount))
    db.commit()
    return collection_read(collection)


@router.delete("/{collection_id}/items/{item_id}", response_model=CollectionRead)
def delete_item(collection_id: int, item_id: int, db: Session = Depends(get_db)) -> CollectionRead:
    collection = _get_collection(db, collection_id)
    item = db.get(CollectionItem, item_id)
    if item is None or item.collection_id != collection_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Collection item not found")
    collection.items.remove(item)
    db.commit()
    return collection_read(collection)
