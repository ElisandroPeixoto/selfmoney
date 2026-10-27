import calendar
from collections import defaultdict
from datetime import date
from decimal import Decimal

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.models import (
    Account,
    AccountMovement,
    Budget,
    BudgetItem,
    Category,
    Currency,
    Transaction,
    TransactionType,
)
from app.schemas import (
    AccountRead,
    BudgetItemRead,
    BudgetRead,
    CategorySpending,
    CurrencyTotal,
    DashboardSummary,
    MonthTotals,
)

UNCATEGORIZED_NAME = "Sem categoria"
UNCATEGORIZED_COLOR = "#94a3b8"


def account_balances(db: Session) -> dict[int, Decimal]:
    signed_amount = case(
        (Transaction.type == TransactionType.INCOME, Transaction.amount),
        else_=-Transaction.amount,
    )
    rows = db.execute(
        select(Transaction.account_id, func.sum(signed_amount)).group_by(Transaction.account_id)
    ).all()
    balances: dict[int, Decimal] = defaultdict(Decimal)
    for account_id, total in rows:
        balances[account_id] += Decimal(str(total))

    # Deposits, withdrawals and transfers: credit the destination, debit the source.
    for column, sign in ((AccountMovement.to_account_id, 1), (AccountMovement.from_account_id, -1)):
        movement_rows = db.execute(
            select(column, func.sum(AccountMovement.amount))
            .where(column.is_not(None))
            .group_by(column)
        ).all()
        for account_id, total in movement_rows:
            balances[account_id] += sign * Decimal(str(total))
    return dict(balances)


def to_account_read(account: Account, movement: Decimal = Decimal("0")) -> AccountRead:
    return AccountRead(
        id=account.id,
        name=account.name,
        initial_balance=account.initial_balance,
        balance=_money(account.initial_balance + movement),
        currency=account.currency,
        bank=account.bank,
    )


def list_accounts_with_balance(db: Session) -> list[AccountRead]:
    movements = account_balances(db)
    accounts = db.scalars(select(Account).order_by(Account.name))
    return [to_account_read(a, movements.get(a.id, Decimal("0"))) for a in accounts]


def period_bounds(year: int, month: int | None = None) -> tuple[date, date]:
    """First and last day of a month, or of the whole year when month is None."""
    if month is None:
        return date(year, 1, 1), date(year, 12, 31)
    return date(year, month, 1), date(year, month, calendar.monthrange(year, month)[1])


def spending_by_category(
    db: Session, year: int, month: int, currency: Currency
) -> list[CategorySpending]:
    first_day, last_day = period_bounds(year, month)
    total = func.sum(Transaction.amount)
    rows = db.execute(
        select(Category.id, Category.name, Category.color, Category.icon, total)
        .select_from(Transaction)
        .join(Account, Transaction.account_id == Account.id)
        .outerjoin(Category, Transaction.category_id == Category.id)
        .where(
            Transaction.type == TransactionType.EXPENSE,
            Transaction.date.between(first_day, last_day),
            Account.currency == currency,
        )
        .group_by(Category.id, Category.name, Category.color, Category.icon)
        .order_by(total.desc())
    ).all()
    return [
        CategorySpending(
            category_id=cat_id,
            name=name or UNCATEGORIZED_NAME,
            color=color or UNCATEGORIZED_COLOR,
            icon=icon,
            total=_money(Decimal(str(amount))),
        )
        for cat_id, name, color, icon, amount in rows
    ]


def monthly_totals(db: Session, year: int, currency: Currency) -> list[MonthTotals]:
    first_day, last_day = period_bounds(year)
    month_col = func.extract("month", Transaction.date)
    rows = db.execute(
        select(month_col, Transaction.type, func.sum(Transaction.amount))
        .join(Account, Transaction.account_id == Account.id)
        .where(Transaction.date.between(first_day, last_day), Account.currency == currency)
        .group_by(month_col, Transaction.type)
    ).all()

    totals = {
        m: {TransactionType.INCOME: Decimal("0"), TransactionType.EXPENSE: Decimal("0")}
        for m in range(1, 13)
    }
    for month, tx_type, amount in rows:
        totals[int(month)][TransactionType(tx_type)] = Decimal(str(amount))
    return [
        MonthTotals(
            month=m,
            income=_money(values[TransactionType.INCOME]),
            expense=_money(values[TransactionType.EXPENSE]),
        )
        for m, values in totals.items()
    ]


def dashboard_summary(
    db: Session, year: int, month: int, currency: Currency = Currency.BRL
) -> DashboardSummary:
    accounts = list_accounts_with_balance(db)
    spending = spending_by_category(db, year, month, currency)

    totals: dict[Currency, Decimal] = defaultdict(Decimal)
    for account in accounts:
        totals[account.currency] += account.balance

    return DashboardSummary(
        year=year,
        month=month,
        balances_by_currency=[
            CurrencyTotal(currency=cur, total=_money(totals[cur]))
            for cur in Currency
            if cur in totals
        ],
        currency=currency,
        month_expenses=_money(sum((s.total for s in spending), Decimal("0"))),
        accounts=accounts,
        spending_by_category=spending,
    )


def _money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"))


class BudgetLinkError(ValueError):
    """Raised when an expense can't be counted against a budget item."""


def check_budget_link(
    db: Session,
    item_id: int,
    tx_type: TransactionType,
    tx_date: date,
    account: Account,
) -> None:
    item = db.get(BudgetItem, item_id)
    if item is None:
        raise BudgetLinkError("Budget item not found")
    budget = item.budget
    if tx_type != TransactionType.EXPENSE:
        raise BudgetLinkError("Only expenses can be linked to a budget")
    if (tx_date.year, tx_date.month) != (budget.year, budget.month):
        raise BudgetLinkError("Expense date is outside the budget's month")
    if account.currency != budget.currency:
        raise BudgetLinkError("Expense account currency differs from the budget's")


def budget_read(db: Session, budget: Budget) -> BudgetRead:
    item_ids = [item.id for item in budget.items]
    spent_by_item: dict[int, Decimal] = {}
    if item_ids:
        rows = db.execute(
            select(Transaction.budget_item_id, func.sum(Transaction.amount))
            .where(
                Transaction.budget_item_id.in_(item_ids),
                Transaction.type == TransactionType.EXPENSE,
            )
            .group_by(Transaction.budget_item_id)
        ).all()
        spent_by_item = {item_id: Decimal(str(total)) for item_id, total in rows}

    items = [
        BudgetItemRead(
            id=item.id,
            name=item.name,
            planned=_money(item.planned),
            spent=_money(spent_by_item.get(item.id, Decimal("0"))),
            available=_money(item.planned - spent_by_item.get(item.id, Decimal("0"))),
        )
        for item in budget.items
    ]
    planned = sum((i.planned for i in items), Decimal("0"))
    spent = sum((i.spent for i in items), Decimal("0"))
    return BudgetRead(
        id=budget.id,
        year=budget.year,
        month=budget.month,
        currency=budget.currency,
        planned=_money(planned),
        spent=_money(spent),
        available=_money(planned - spent),
        items=items,
    )
