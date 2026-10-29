import calendar
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta, timezone
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
    MovementRead,
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
    db: Session,
    year: int,
    month: int,
    currency: Currency,
    tx_type: TransactionType = TransactionType.EXPENSE,
) -> list[CategorySpending]:
    """Totals per category for one month; expenses by default, or income."""
    first_day, last_day = period_bounds(year, month)
    total = func.sum(Transaction.amount)
    rows = db.execute(
        select(Category.id, Category.name, Category.color, Category.icon, total)
        .select_from(Transaction)
        .join(Account, Transaction.account_id == Account.id)
        .outerjoin(Category, Transaction.category_id == Category.id)
        .where(
            Transaction.type == tx_type,
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


REPORT_HISTORY_MONTHS = 6


@dataclass(frozen=True)
class ReportMonth:
    year: int
    month: int
    income: Decimal
    expense: Decimal


@dataclass(frozen=True)
class ReportTransaction:
    date: date
    description: str
    type: TransactionType
    amount: Decimal
    category: str
    account: str
    budget_item: str | None


@dataclass(frozen=True)
class MonthlyReport:
    year: int
    month: int
    currency: Currency
    generated_at: datetime
    income: Decimal
    expense: Decimal
    previous: ReportMonth
    # Oldest first, ending at the report's month.
    history: list[ReportMonth]
    spending: list[CategorySpending]
    income_by_category: list[CategorySpending]
    budget: BudgetRead | None
    accounts: list[AccountRead]
    balances_by_currency: list[CurrencyTotal]
    transactions: list[ReportTransaction]
    movements: list[MovementRead]


def _shift_month(year: int, month: int, delta: int) -> tuple[int, int]:
    index = year * 12 + (month - 1) + delta
    return index // 12, index % 12 + 1


def monthly_report(
    db: Session,
    year: int,
    month: int,
    currency: Currency,
    utc_offset_minutes: int = 0,
    now: datetime | None = None,
) -> MonthlyReport:
    """Everything the monthly PDF shows, for one month and one currency.

    `utc_offset_minutes` is the reader's offset: it sets the generation time shown and which
    movements (stored in UTC) fall inside the month.
    """
    tz = timezone(timedelta(minutes=utc_offset_minutes))
    generated_at = (now or datetime.now(UTC)).astimezone(tz)

    months = [_shift_month(year, month, -i) for i in range(REPORT_HISTORY_MONTHS - 1, -1, -1)]
    totals_by_year = {y: monthly_totals(db, y, currency) for y in {y for y, _ in months}}
    history = [
        ReportMonth(y, m, totals_by_year[y][m - 1].income, totals_by_year[y][m - 1].expense)
        for y, m in months
    ]
    current, previous = history[-1], history[-2]

    summary = dashboard_summary(db, year, month, currency)
    budget = db.scalar(
        select(Budget).where(
            Budget.year == year, Budget.month == month, Budget.currency == currency
        )
    )

    first_day, last_day = period_bounds(year, month)
    tx_rows = db.execute(
        select(Transaction, Account.name, Category.name, BudgetItem.name)
        .join(Account, Transaction.account_id == Account.id)
        .outerjoin(Category, Transaction.category_id == Category.id)
        .outerjoin(BudgetItem, Transaction.budget_item_id == BudgetItem.id)
        .where(Transaction.date.between(first_day, last_day), Account.currency == currency)
        .order_by(Transaction.date, Transaction.id)
    ).all()
    transactions = [
        ReportTransaction(
            date=tx.date,
            description=tx.description,
            type=tx.type,
            amount=_money(tx.amount),
            category=category_name or UNCATEGORIZED_NAME,
            account=account_name,
            budget_item=item_name,
        )
        for tx, account_name, category_name, item_name in tx_rows
    ]

    # The month in the reader's time zone, compared in UTC like the stored values.
    next_year, next_month = _shift_month(year, month, 1)
    month_start = datetime(year, month, 1, tzinfo=tz).astimezone(UTC)
    month_end = datetime(next_year, next_month, 1, tzinfo=tz).astimezone(UTC)
    movements = db.scalars(
        select(AccountMovement)
        .where(
            AccountMovement.currency == currency,
            AccountMovement.created_at >= month_start,
            AccountMovement.created_at < month_end,
        )
        .order_by(AccountMovement.created_at, AccountMovement.id)
    )

    return MonthlyReport(
        year=year,
        month=month,
        currency=currency,
        generated_at=generated_at,
        income=current.income,
        expense=current.expense,
        previous=previous,
        history=history,
        spending=summary.spending_by_category,
        income_by_category=spending_by_category(db, year, month, currency, TransactionType.INCOME),
        budget=budget_read(db, budget) if budget else None,
        accounts=summary.accounts,
        balances_by_currency=summary.balances_by_currency,
        transactions=transactions,
        movements=[MovementRead.model_validate(m) for m in movements],
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
