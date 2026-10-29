from datetime import UTC, date, datetime
from decimal import Decimal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_serializer,
    field_validator,
    model_validator,
)

from app.models import Bank, Currency, MovementKind, TransactionType

HEX_COLOR = r"^#[0-9a-fA-F]{6}$"
_Date = date


class AccountCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    initial_balance: Decimal = Field(default=Decimal("0"), max_digits=14, decimal_places=2)
    currency: Currency = Currency.BRL
    bank: Bank | None = None


class AccountUpdate(BaseModel):
    """Partial update: only fields present in the request body are changed."""

    name: str | None = Field(default=None, min_length=1, max_length=100)
    currency: Currency | None = None
    bank: Bank | None = None


class AccountRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    initial_balance: Decimal
    balance: Decimal
    currency: Currency
    bank: Bank | None


IconField = Field(default=None, min_length=1, max_length=16)


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    color: str = Field(default="#6366f1", pattern=HEX_COLOR)
    icon: str | None = IconField
    kind: TransactionType = TransactionType.EXPENSE


class CategoryUpdate(BaseModel):
    """Partial update: only fields present in the request body are changed."""

    name: str | None = Field(default=None, min_length=1, max_length=100)
    color: str | None = Field(default=None, pattern=HEX_COLOR)
    icon: str | None = IconField
    kind: TransactionType | None = None


class CategoryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    color: str
    icon: str | None
    kind: TransactionType


class TransactionCreate(BaseModel):
    description: str = Field(min_length=1, max_length=200)
    amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2)
    type: TransactionType
    date: date
    account_id: int
    category_id: int | None = None
    budget_item_id: int | None = None


class TransactionUpdate(BaseModel):
    """Partial update: only fields present in the request body are changed."""

    description: str | None = Field(default=None, min_length=1, max_length=200)
    amount: Decimal | None = Field(default=None, gt=0, max_digits=14, decimal_places=2)
    type: TransactionType | None = None
    # Annotated via an alias: the field name `date` would otherwise shadow the type here.
    date: _Date | None = None
    account_id: int | None = None
    category_id: int | None = None
    budget_item_id: int | None = None


class TransactionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    description: str
    amount: Decimal
    type: TransactionType
    date: date
    account_id: int
    category_id: int | None
    budget_item_id: int | None


class CategorySpending(BaseModel):
    category_id: int | None
    name: str
    color: str
    icon: str | None
    total: Decimal


class MonthTotals(BaseModel):
    month: int
    income: Decimal
    expense: Decimal


class CurrencyTotal(BaseModel):
    currency: Currency
    total: Decimal


class DashboardSummary(BaseModel):
    year: int
    month: int
    # Balances can't be summed across currencies, so there is one total per currency.
    balances_by_currency: list[CurrencyTotal]
    # Currency of month_expenses / spending_by_category (only accounts in it are counted).
    currency: Currency
    month_expenses: Decimal
    accounts: list[AccountRead]
    spending_by_category: list[CategorySpending]


def _two_places(value: Decimal | None) -> Decimal | None:
    return None if value is None else value.quantize(Decimal("0.01"))


class BudgetCreate(BaseModel):
    year: int = Field(ge=2000, le=2100)
    month: int = Field(ge=1, le=12)
    currency: Currency = Currency.BRL
    # Optionally start from a saved template or from another month's budget.
    template_id: int | None = None
    source_budget_id: int | None = None

    @model_validator(mode="after")
    def single_source(self) -> "BudgetCreate":
        if self.template_id is not None and self.source_budget_id is not None:
            raise ValueError("Use either template_id or source_budget_id, not both")
        return self


class BudgetItemCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    planned: Decimal = Field(ge=0, max_digits=14, decimal_places=2)

    # Stored amounts are copied into templates as-is, so normalize them here.
    _normalize_planned = field_validator("planned")(_two_places)


class BudgetItemUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    planned: Decimal | None = Field(default=None, ge=0, max_digits=14, decimal_places=2)

    _normalize_planned = field_validator("planned")(_two_places)


class BudgetItemRead(BaseModel):
    id: int
    name: str
    planned: Decimal
    spent: Decimal
    available: Decimal


class BudgetRead(BaseModel):
    id: int
    year: int
    month: int
    currency: Currency
    planned: Decimal
    spent: Decimal
    available: Decimal
    items: list[BudgetItemRead]


class BudgetTemplateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class BudgetTemplateItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    planned: Decimal


class BudgetTemplateRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    items: list[BudgetTemplateItemRead]


class _MovementBase(BaseModel):
    amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2)
    reason: str = Field(max_length=500)

    @field_validator("reason")
    @classmethod
    def require_reason(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 3:
            raise ValueError("A justification of at least 3 characters is required")
        return value


class DepositCreate(_MovementBase):
    account_id: int


class WithdrawalCreate(_MovementBase):
    account_id: int


class TransferCreate(_MovementBase):
    from_account_id: int
    to_account_id: int

    @model_validator(mode="after")
    def different_accounts(self) -> "TransferCreate":
        if self.from_account_id == self.to_account_id:
            raise ValueError("Source and destination accounts must differ")
        return self


class MovementRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: MovementKind
    amount: Decimal
    currency: Currency
    reason: str
    from_account_id: int | None
    to_account_id: int | None
    from_account_name: str | None
    to_account_name: str | None
    created_at: datetime

    @field_serializer("created_at")
    def as_utc(self, value: datetime) -> str:
        # SQLite drops the timezone; stored values are always UTC.
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value.isoformat()


class AuthStatus(BaseModel):
    auth_required: bool
    authenticated: bool


class LoginRequest(BaseModel):
    password: str = Field(max_length=200)


class LoginResponse(BaseModel):
    token: str
    expires_at: datetime


DayOfMonth = Field(default=None, ge=1, le=31)


class CreditCardCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    account_id: int | None = None
    # Ignored when an account is linked: the card uses the account's currency.
    currency: Currency = Currency.BRL
    due_day: int | None = DayOfMonth
    auto_export: bool = False


class CreditCardUpdate(BaseModel):
    """Partial update: only fields present in the request body are changed."""

    name: str | None = Field(default=None, min_length=1, max_length=100)
    account_id: int | None = None
    currency: Currency | None = None
    due_day: int | None = DayOfMonth
    auto_export: bool | None = None


class CreditCardRead(BaseModel):
    id: int
    name: str
    account_id: int | None
    account_name: str | None
    currency: Currency
    due_day: int | None
    auto_export: bool
    # Installments not exported to the transactions yet, in any month.
    pending_total: Decimal


class CardPurchaseCreate(BaseModel):
    description: str = Field(min_length=1, max_length=150)
    amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2)
    installments: int = Field(default=1, ge=1, le=48)
    date: date
    # Bill of the first installment; defaults to the month after the purchase.
    first_year: int | None = Field(default=None, ge=2000, le=2100)
    first_month: int | None = Field(default=None, ge=1, le=12)
    category_id: int | None = None

    @model_validator(mode="after")
    def whole_first_bill(self) -> "CardPurchaseCreate":
        if (self.first_year is None) != (self.first_month is None):
            raise ValueError("Send both first_year and first_month, or neither")
        return self


class CardPurchaseRead(BaseModel):
    id: int
    card_id: int
    description: str
    amount: Decimal
    installments: int
    installment_amount: Decimal
    date: date
    first_year: int
    first_month: int
    category_id: int | None
    exported_installments: int


class CardInstallmentRead(BaseModel):
    purchase_id: int
    description: str
    number: int
    installments: int
    amount: Decimal
    category_id: int | None
    # The exported expense, if any.
    transaction_id: int | None


class CardBillRead(BaseModel):
    year: int
    month: int
    total: Decimal
    pending_total: Decimal
    installments: list[CardInstallmentRead]


class CardExportResult(BaseModel):
    created: int
    bill: CardBillRead
