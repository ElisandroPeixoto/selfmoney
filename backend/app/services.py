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
    CardPurchase,
    Category,
    CreditCard,
    Currency,
    Transaction,
    TransactionType,
)
from app.schemas import (
    AccountRead,
    BudgetItemRead,
    BudgetRead,
    CardBillRead,
    CardInstallmentRead,
    CardPurchaseRead,
    CategorySpending,
    CreditCardRead,
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


# Credit cards


class CardExportError(ValueError):
    """Raised when card installments can't be exported to the transactions."""


def installment_amounts(total: Decimal, count: int) -> list[Decimal]:
    """Split a price into installments; leftover cents go to the first one."""
    cents = int(_money(total) * 100)
    base, leftover = divmod(cents, count)
    amounts = [Decimal(base) / 100] * count
    amounts[0] = Decimal(base + leftover) / 100
    return [_money(a) for a in amounts]


def default_first_bill(purchase_date: date) -> tuple[int, int]:
    return _shift_month(purchase_date.year, purchase_date.month, 1)


def _installment_months(purchase: CardPurchase) -> list[tuple[int, int]]:
    return [
        _shift_month(purchase.first_year, purchase.first_month, i)
        for i in range(purchase.installments)
    ]


def _exported(db: Session, purchase_ids: list[int]) -> dict[tuple[int, int], int]:
    """(purchase id, installment number) -> id of the exported transaction."""
    if not purchase_ids:
        return {}
    rows = db.execute(
        select(Transaction.card_purchase_id, Transaction.card_installment, Transaction.id).where(
            Transaction.card_purchase_id.in_(purchase_ids)
        )
    )
    return {(purchase_id, number): tx_id for purchase_id, number, tx_id in rows}


def _installments(
    db: Session, purchases: list[CardPurchase]
) -> list[tuple[tuple[int, int], CardInstallmentRead]]:
    exported = _exported(db, [p.id for p in purchases])
    result = []
    for purchase in purchases:
        amounts = installment_amounts(purchase.amount, purchase.installments)
        for number, (bill, amount) in enumerate(
            zip(_installment_months(purchase), amounts, strict=True), start=1
        ):
            installment = CardInstallmentRead(
                purchase_id=purchase.id,
                description=purchase.description,
                number=number,
                installments=purchase.installments,
                amount=amount,
                category_id=purchase.category_id,
                transaction_id=exported.get((purchase.id, number)),
            )
            result.append((bill, installment))
    return result


def _card_purchases(db: Session, card_id: int) -> list[CardPurchase]:
    query = (
        select(CardPurchase)
        .where(CardPurchase.card_id == card_id)
        .order_by(CardPurchase.date, CardPurchase.id)
    )
    return list(db.scalars(query))


def card_read(db: Session, card: CreditCard) -> CreditCardRead:
    pending = sum(
        (
            i.amount
            for _, i in _installments(db, _card_purchases(db, card.id))
            if not i.transaction_id
        ),
        Decimal("0"),
    )
    return CreditCardRead(
        id=card.id,
        name=card.name,
        account_id=card.account_id,
        account_name=card.account.name if card.account else None,
        currency=card.currency,
        due_day=card.due_day,
        auto_export=card.auto_export,
        pending_total=_money(pending),
    )


def purchase_reads(db: Session, purchases: list[CardPurchase]) -> list[CardPurchaseRead]:
    exported = _exported(db, [p.id for p in purchases])
    return [
        CardPurchaseRead(
            id=p.id,
            card_id=p.card_id,
            description=p.description,
            amount=p.amount,
            installments=p.installments,
            installment_amount=installment_amounts(p.amount, p.installments)[-1],
            date=p.date,
            first_year=p.first_year,
            first_month=p.first_month,
            category_id=p.category_id,
            exported_installments=sum(1 for purchase_id, _ in exported if purchase_id == p.id),
        )
        for p in purchases
    ]


def card_bills(
    db: Session, card: CreditCard, year: int, month: int, months: int = 1
) -> list[CardBillRead]:
    """Bills of `months` consecutive months starting at year/month."""
    by_month: dict[tuple[int, int], list[CardInstallmentRead]] = defaultdict(list)
    for bill, installment in _installments(db, _card_purchases(db, card.id)):
        by_month[bill].append(installment)
    bills = []
    for offset in range(months):
        key = _shift_month(year, month, offset)
        items = by_month.get(key, [])
        total = sum((i.amount for i in items), Decimal("0"))
        pending = sum((i.amount for i in items if i.transaction_id is None), Decimal("0"))
        bills.append(
            CardBillRead(
                year=key[0],
                month=key[1],
                total=_money(total),
                pending_total=_money(pending),
                installments=items,
            )
        )
    return bills


def _export_date(card: CreditCard, purchase: CardPurchase, year: int, month: int) -> date:
    day = card.due_day or purchase.date.day
    return date(year, month, min(day, calendar.monthrange(year, month)[1]))


def export_card_installments(
    db: Session,
    card: CreditCard,
    bill: tuple[int, int] | None = None,
    purchase_id: int | None = None,
) -> int:
    """Create an expense for each pending installment (of one bill, or of one purchase).

    Already exported installments are skipped. Doesn't commit.
    """
    if card.account_id is None:
        raise CardExportError("Link the card to an account before exporting")
    purchases = {p.id: p for p in _card_purchases(db, card.id)}
    if purchase_id is not None:
        purchases = {purchase_id: purchases[purchase_id]}
    created = 0
    for (year, month), installment in _installments(db, list(purchases.values())):
        if installment.transaction_id is not None or (bill and (year, month) != bill):
            continue
        purchase = purchases[installment.purchase_id]
        # The category may have become an income one since the purchase was added.
        category = purchase.category
        suffix = f" ({installment.number}/{purchase.installments})"
        db.add(
            Transaction(
                description=purchase.description + (suffix if purchase.installments > 1 else ""),
                amount=installment.amount,
                type=TransactionType.EXPENSE,
                date=_export_date(card, purchase, year, month),
                account_id=card.account_id,
                category_id=(
                    category.id if category and category.kind == TransactionType.EXPENSE else None
                ),
                card_purchase_id=purchase.id,
                card_installment=installment.number,
            )
        )
        created += 1
    db.flush()
    return created
