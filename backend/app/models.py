import enum
from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Numeric, String, UniqueConstraint, func
from sqlalchemy import false as sa_false
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

Money = Numeric(14, 2)


class TransactionType(enum.StrEnum):
    INCOME = "income"
    EXPENSE = "expense"


class Currency(enum.StrEnum):
    BRL = "BRL"
    USD = "USD"
    EUR = "EUR"


class MovementKind(enum.StrEnum):
    TRANSFER = "transfer"
    DEPOSIT = "deposit"
    WITHDRAWAL = "withdrawal"


class Bank(enum.StrEnum):
    NUBANK = "nubank"
    BANCO_DO_BRASIL = "banco_do_brasil"
    ITAU = "itau"


def _string_enum(enum_cls: type[enum.StrEnum], length: int) -> Enum:
    # Stored as VARCHAR (not a native DB enum) so new options don't require type migrations.
    return Enum(
        enum_cls,
        native_enum=False,
        length=length,
        values_callable=lambda e: [m.value for m in e],
    )


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    initial_balance: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    currency: Mapped[Currency] = mapped_column(
        _string_enum(Currency, 3), default=Currency.BRL, server_default=Currency.BRL.value
    )
    bank: Mapped[Bank | None] = mapped_column(_string_enum(Bank, 32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    transactions: Mapped[list["Transaction"]] = relationship(back_populates="account")


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    color: Mapped[str] = mapped_column(String(7), default="#6366f1")
    # A single emoji chosen in the UI; optional.
    icon: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # Whether the category classifies expenses or income; must match its transactions' type.
    kind: Mapped[TransactionType] = mapped_column(
        _string_enum(TransactionType, 16),
        default=TransactionType.EXPENSE,
        server_default=TransactionType.EXPENSE.value,
    )

    transactions: Mapped[list["Transaction"]] = relationship(back_populates="category")


class Transaction(Base):
    __tablename__ = "transactions"
    # Each card installment is exported at most once.
    __table_args__ = (
        UniqueConstraint(
            "card_purchase_id", "card_installment", name="uq_transactions_card_installment"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    description: Mapped[str] = mapped_column(String(200))
    amount: Mapped[Decimal] = mapped_column(Money)
    type: Mapped[TransactionType] = mapped_column(
        Enum(
            TransactionType, name="transaction_type", values_callable=lambda e: [m.value for m in e]
        )
    )
    date: Mapped[date] = mapped_column(Date, index=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"))
    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), nullable=True
    )
    # Budget envelope this expense counts against (see Budget).
    budget_item_id: Mapped[int | None] = mapped_column(
        ForeignKey("budget_items.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Set when the expense was exported from a credit card installment (see CardPurchase).
    card_purchase_id: Mapped[int | None] = mapped_column(
        ForeignKey("card_purchases.id", ondelete="SET NULL", name="fk_transactions_card_purchase"),
        nullable=True,
        index=True,
    )
    card_installment: Mapped[int | None] = mapped_column(nullable=True)

    account: Mapped[Account] = relationship(back_populates="transactions")
    category: Mapped[Category | None] = relationship(back_populates="transactions")
    budget_item: Mapped["BudgetItem | None"] = relationship(back_populates="transactions")


class Budget(Base):
    """A month's spending plan: a set of items, each with a planned amount."""

    __tablename__ = "budgets"
    __table_args__ = (UniqueConstraint("year", "month", name="uq_budgets_year_month"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    year: Mapped[int]
    month: Mapped[int]
    currency: Mapped[Currency] = mapped_column(
        _string_enum(Currency, 3), default=Currency.BRL, server_default=Currency.BRL.value
    )
    # Amount the user intends to set aside this month; "Extras" is what's left after it.
    saving: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"), server_default="0")
    auto_extras: Mapped[bool] = mapped_column(default=False, server_default=sa_false())

    items: Mapped[list["BudgetItem"]] = relationship(
        back_populates="budget", cascade="all, delete-orphan", order_by="BudgetItem.id"
    )


class BudgetItem(Base):
    __tablename__ = "budget_items"
    __table_args__ = (UniqueConstraint("budget_id", "name", name="uq_budget_items_name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    budget_id: Mapped[int] = mapped_column(ForeignKey("budgets.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(100))
    planned: Mapped[Decimal] = mapped_column(Money)
    # The automatic "Extras" item: its planned amount is derived on read, never stored.
    is_extras: Mapped[bool] = mapped_column(default=False, server_default=sa_false())

    budget: Mapped[Budget] = relationship(back_populates="items")
    transactions: Mapped[list[Transaction]] = relationship(back_populates="budget_item")


class BudgetTemplate(Base):
    """A reusable budget structure (item names and planned amounts) without a month."""

    __tablename__ = "budget_templates"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)

    items: Mapped[list["BudgetTemplateItem"]] = relationship(
        back_populates="template", cascade="all, delete-orphan", order_by="BudgetTemplateItem.id"
    )


class BudgetTemplateItem(Base):
    __tablename__ = "budget_template_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    template_id: Mapped[int] = mapped_column(ForeignKey("budget_templates.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(100))
    planned: Mapped[Decimal] = mapped_column(Money)

    template: Mapped[BudgetTemplate] = relationship(back_populates="items")


class AccountMovement(Base):
    """Money moved into, out of or between accounts, outside any month's records.

    Rows form an append-only log. Account names are copied so the log stays
    readable after an account is renamed or deleted.
    """

    __tablename__ = "account_movements"

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[MovementKind] = mapped_column(_string_enum(MovementKind, 16))
    amount: Mapped[Decimal] = mapped_column(Money)
    currency: Mapped[Currency] = mapped_column(_string_enum(Currency, 3))
    reason: Mapped[str] = mapped_column(String(500))
    # Deposits have no source; withdrawals have no destination.
    from_account_id: Mapped[int | None] = mapped_column(
        ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True, index=True
    )
    to_account_id: Mapped[int | None] = mapped_column(
        ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True, index=True
    )
    from_account_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    to_account_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), index=True
    )


class CreditCard(Base):
    """A credit card whose purchases are split into monthly installments.

    Installments are exported as expenses of the linked account; the card's currency
    follows that account.
    """

    __tablename__ = "credit_cards"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    account_id: Mapped[int | None] = mapped_column(
        ForeignKey("accounts.id", ondelete="SET NULL", name="fk_credit_cards_account"),
        nullable=True,
    )
    currency: Mapped[Currency] = mapped_column(
        _string_enum(Currency, 3), default=Currency.BRL, server_default=Currency.BRL.value
    )
    # Day of the month the bill is paid; exported expenses are dated on it.
    due_day: Mapped[int | None] = mapped_column(nullable=True)
    # Export every installment to the transactions as soon as a purchase is added.
    auto_export: Mapped[bool] = mapped_column(default=False, server_default=sa_false())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    account: Mapped[Account | None] = relationship()
    purchases: Mapped[list["CardPurchase"]] = relationship(
        back_populates="card", cascade="all, delete-orphan"
    )


class CardPurchase(Base):
    __tablename__ = "card_purchases"

    id: Mapped[int] = mapped_column(primary_key=True)
    card_id: Mapped[int] = mapped_column(
        ForeignKey("credit_cards.id", ondelete="CASCADE", name="fk_card_purchases_card"),
        index=True,
    )
    description: Mapped[str] = mapped_column(String(150))
    # Total price; installments split it (see services.installment_amounts).
    amount: Mapped[Decimal] = mapped_column(Money)
    installments: Mapped[int]
    date: Mapped[date] = mapped_column(Date)
    # Bill (month) of the first installment; the others follow month by month.
    first_year: Mapped[int]
    first_month: Mapped[int]
    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL", name="fk_card_purchases_category"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    card: Mapped[CreditCard] = relationship(back_populates="purchases")
    category: Mapped[Category | None] = relationship()


class BalanceCheck(Base):
    """A moment at which the user reviewed their finances (a "balanço")."""

    __tablename__ = "balance_checks"

    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), index=True
    )


class SpendingCollection(Base):
    """A named group of recurring costs (e.g. subscriptions) whose amounts are summed."""

    __tablename__ = "spending_collections"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    currency: Mapped[Currency] = mapped_column(
        _string_enum(Currency, 3), default=Currency.BRL, server_default=Currency.BRL.value
    )

    items: Mapped[list["CollectionItem"]] = relationship(
        back_populates="collection", cascade="all, delete-orphan", order_by="CollectionItem.id"
    )


class CollectionItem(Base):
    __tablename__ = "collection_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    collection_id: Mapped[int] = mapped_column(
        ForeignKey("spending_collections.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(100))
    amount: Mapped[Decimal] = mapped_column(Money)

    collection: Mapped[SpendingCollection] = relationship(back_populates="items")
