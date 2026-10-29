"""credit cards

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-28 22:56:44.913676
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # A dev server with AUTO_CREATE_TABLES may have created the (empty) new tables already.
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    if "credit_cards" not in existing:
        op.create_table(
            "credit_cards",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(length=100), nullable=False),
            sa.Column("account_id", sa.Integer(), nullable=True),
            sa.Column(
                "currency",
                sa.Enum("BRL", "USD", "EUR", name="currency", native_enum=False, length=3),
                server_default="BRL",
                nullable=False,
            ),
            sa.Column("due_day", sa.Integer(), nullable=True),
            sa.Column("auto_export", sa.Boolean(), server_default=sa.false(), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.ForeignKeyConstraint(
                ["account_id"],
                ["accounts.id"],
                name="fk_credit_cards_account",
                ondelete="SET NULL",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("name"),
        )
    if "card_purchases" not in existing:
        op.create_table(
            "card_purchases",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("card_id", sa.Integer(), nullable=False),
            sa.Column("description", sa.String(length=150), nullable=False),
            sa.Column("amount", sa.Numeric(precision=14, scale=2), nullable=False),
            sa.Column("installments", sa.Integer(), nullable=False),
            sa.Column("date", sa.Date(), nullable=False),
            sa.Column("first_year", sa.Integer(), nullable=False),
            sa.Column("first_month", sa.Integer(), nullable=False),
            sa.Column("category_id", sa.Integer(), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.ForeignKeyConstraint(
                ["card_id"],
                ["credit_cards.id"],
                name="fk_card_purchases_card",
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["category_id"],
                ["categories.id"],
                name="fk_card_purchases_category",
                ondelete="SET NULL",
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        with op.batch_alter_table("card_purchases", schema=None) as batch_op:
            batch_op.create_index(
                batch_op.f("ix_card_purchases_card_id"), ["card_id"], unique=False
            )

    with op.batch_alter_table("transactions", schema=None) as batch_op:
        batch_op.add_column(sa.Column("card_purchase_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("card_installment", sa.Integer(), nullable=True))
        batch_op.create_index(
            batch_op.f("ix_transactions_card_purchase_id"), ["card_purchase_id"], unique=False
        )
        batch_op.create_unique_constraint(
            "uq_transactions_card_installment", ["card_purchase_id", "card_installment"]
        )
        batch_op.create_foreign_key(
            "fk_transactions_card_purchase",
            "card_purchases",
            ["card_purchase_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    with op.batch_alter_table("transactions", schema=None) as batch_op:
        batch_op.drop_constraint("fk_transactions_card_purchase", type_="foreignkey")
        batch_op.drop_constraint("uq_transactions_card_installment", type_="unique")
        batch_op.drop_index(batch_op.f("ix_transactions_card_purchase_id"))
        batch_op.drop_column("card_installment")
        batch_op.drop_column("card_purchase_id")

    op.drop_table("card_purchases")
    op.drop_table("credit_cards")
