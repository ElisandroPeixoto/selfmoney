from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Budget, BudgetItem, BudgetTemplate, BudgetTemplateItem, Transaction
from app.schemas import (
    BudgetCreate,
    BudgetItemCreate,
    BudgetItemUpdate,
    BudgetRead,
    BudgetTemplateCreate,
    BudgetTemplateRead,
    BudgetUpdate,
)
from app.services import EXTRAS_NAME, budget_read

router = APIRouter(tags=["budgets"])


def _get_budget(db: Session, budget_id: int) -> Budget:
    budget = db.get(Budget, budget_id)
    if budget is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Budget not found")
    return budget


def _get_item(db: Session, budget_id: int, item_id: int) -> BudgetItem:
    item = db.get(BudgetItem, item_id)
    if item is None or item.budget_id != budget_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Budget item not found")
    return item


def _ensure_unique_item_name(budget: Budget, name: str, exclude_id: int | None = None) -> None:
    if any(i.name == name and i.id != exclude_id for i in budget.items):
        raise HTTPException(status.HTTP_409_CONFLICT, "Item name already exists in this budget")


def _unlink_items(db: Session, item_ids: list[int]) -> None:
    # Explicit because SQLite doesn't enforce ON DELETE SET NULL by default.
    if item_ids:
        db.execute(
            update(Transaction)
            .where(Transaction.budget_item_id.in_(item_ids))
            .values(budget_item_id=None)
        )


def _remove_extras(db: Session, budget: Budget) -> None:
    for item in [i for i in budget.items if i.is_extras]:
        _unlink_items(db, [item.id])
        budget.items.remove(item)


# Budgets


@router.get("/budgets", response_model=list[BudgetRead])
def list_budgets(db: Session = Depends(get_db)) -> list[BudgetRead]:
    budgets = db.scalars(select(Budget).order_by(Budget.year.desc(), Budget.month.desc()))
    return [budget_read(db, b) for b in budgets]


@router.post("/budgets", response_model=BudgetRead, status_code=status.HTTP_201_CREATED)
def create_budget(payload: BudgetCreate, db: Session = Depends(get_db)) -> BudgetRead:
    existing = db.scalar(
        select(Budget.id).where(Budget.year == payload.year, Budget.month == payload.month)
    )
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "This month already has a budget")

    source_items: list[tuple[str, Decimal]] = []
    if payload.template_id is not None:
        template = db.get(BudgetTemplate, payload.template_id)
        if template is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Template not found")
        source_items = [(i.name, i.planned) for i in template.items]
    elif payload.source_budget_id is not None:
        source = db.get(Budget, payload.source_budget_id)
        if source is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Source budget not found")
        source_items = [(i.name, i.planned) for i in source.items if not i.is_extras]

    budget = Budget(
        year=payload.year,
        month=payload.month,
        currency=payload.currency,
        items=[BudgetItem(name=name, planned=planned) for name, planned in source_items],
    )
    db.add(budget)
    db.commit()
    return budget_read(db, budget)


@router.get("/budgets/{budget_id}", response_model=BudgetRead)
def get_budget(budget_id: int, db: Session = Depends(get_db)) -> BudgetRead:
    return budget_read(db, _get_budget(db, budget_id))


@router.patch("/budgets/{budget_id}", response_model=BudgetRead)
def update_budget(
    budget_id: int, payload: BudgetUpdate, db: Session = Depends(get_db)
) -> BudgetRead:
    budget = _get_budget(db, budget_id)
    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        if value is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"'{field}' cannot be null")
    if changes.get("auto_extras") is True and not budget.auto_extras:
        _ensure_unique_item_name(budget, EXTRAS_NAME)
        budget.items.append(BudgetItem(name=EXTRAS_NAME, planned=Decimal("0"), is_extras=True))
    elif changes.get("auto_extras") is False and budget.auto_extras:
        _remove_extras(db, budget)
    for field, value in changes.items():
        setattr(budget, field, value)
    db.commit()
    return budget_read(db, budget)


@router.delete("/budgets/{budget_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_budget(budget_id: int, db: Session = Depends(get_db)) -> Response:
    budget = _get_budget(db, budget_id)
    _unlink_items(db, [i.id for i in budget.items])
    db.delete(budget)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# Budget items


@router.post(
    "/budgets/{budget_id}/items", response_model=BudgetRead, status_code=status.HTTP_201_CREATED
)
def add_item(
    budget_id: int, payload: BudgetItemCreate, db: Session = Depends(get_db)
) -> BudgetRead:
    budget = _get_budget(db, budget_id)
    _ensure_unique_item_name(budget, payload.name)
    budget.items.append(BudgetItem(name=payload.name, planned=payload.planned))
    db.commit()
    return budget_read(db, budget)


@router.patch("/budgets/{budget_id}/items/{item_id}", response_model=BudgetRead)
def update_item(
    budget_id: int, item_id: int, payload: BudgetItemUpdate, db: Session = Depends(get_db)
) -> BudgetRead:
    budget = _get_budget(db, budget_id)
    item = _get_item(db, budget_id, item_id)
    if item.is_extras:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Extras is calculated automatically"
        )
    changes = payload.model_dump(exclude_unset=True)
    for field in ("name", "planned"):
        if field in changes and changes[field] is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"'{field}' cannot be null")
    if "name" in changes:
        _ensure_unique_item_name(budget, changes["name"], exclude_id=item_id)
    for field, value in changes.items():
        setattr(item, field, value)
    db.commit()
    return budget_read(db, budget)


@router.delete("/budgets/{budget_id}/items/{item_id}", response_model=BudgetRead)
def delete_item(budget_id: int, item_id: int, db: Session = Depends(get_db)) -> BudgetRead:
    budget = _get_budget(db, budget_id)
    item = _get_item(db, budget_id, item_id)
    if item.is_extras:
        budget.auto_extras = False
    _unlink_items(db, [item.id])
    budget.items.remove(item)
    db.commit()
    return budget_read(db, budget)


# Templates


@router.get("/budget-templates", response_model=list[BudgetTemplateRead])
def list_templates(db: Session = Depends(get_db)) -> list[BudgetTemplate]:
    return list(db.scalars(select(BudgetTemplate).order_by(BudgetTemplate.name)))


@router.post(
    "/budgets/{budget_id}/save-template",
    response_model=BudgetTemplateRead,
    status_code=status.HTTP_201_CREATED,
)
def save_as_template(
    budget_id: int, payload: BudgetTemplateCreate, db: Session = Depends(get_db)
) -> BudgetTemplate:
    budget = _get_budget(db, budget_id)
    if db.scalar(select(BudgetTemplate.id).where(BudgetTemplate.name == payload.name)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Template name already exists")
    template = BudgetTemplate(
        name=payload.name,
        items=[
            BudgetTemplateItem(name=i.name, planned=i.planned)
            for i in budget.items
            if not i.is_extras
        ],
    )
    db.add(template)
    db.commit()
    return template


@router.delete("/budget-templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_template(template_id: int, db: Session = Depends(get_db)) -> Response:
    template = db.get(BudgetTemplate, template_id)
    if template is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Template not found")
    db.delete(template)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
