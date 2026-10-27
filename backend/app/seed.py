"""Populate the database with sample data for local development.

Usage: python -m app.seed
"""

from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import select

from app.database import Base, SessionLocal, engine
from app.models import Account, Bank, Category, Transaction, TransactionType

# Colorblind-friendly palette; keep this order when adding categories.
CATEGORIES = [
    ("Moradia", "#2a78d6", "🏠"),
    ("Alimentação", "#eb6834", "🍽️"),
    ("Transporte", "#1baf7a", "🚗"),
    ("Lazer", "#eda100", "🎬"),
    ("Saúde", "#e87ba4", "💊"),
    ("Salário", "#008300", "💼"),
]

ACCOUNTS = [
    ("Conta Corrente", "2500.00", Bank.NUBANK),
    ("Poupança", "10000.00", Bank.BANCO_DO_BRASIL),
    ("Carteira", "300.00", None),
]

# (description, amount, type, category, account, days before today)
TRANSACTIONS = [
    ("Salário", "6500.00", TransactionType.INCOME, "Salário", "Conta Corrente", 20),
    ("Aluguel", "1800.00", TransactionType.EXPENSE, "Moradia", "Conta Corrente", 18),
    ("Conta de luz", "220.40", TransactionType.EXPENSE, "Moradia", "Conta Corrente", 15),
    ("Supermercado", "642.90", TransactionType.EXPENSE, "Alimentação", "Conta Corrente", 12),
    ("Restaurante", "128.00", TransactionType.EXPENSE, "Alimentação", "Carteira", 6),
    ("Combustível", "250.00", TransactionType.EXPENSE, "Transporte", "Conta Corrente", 9),
    ("Uber", "48.50", TransactionType.EXPENSE, "Transporte", "Carteira", 3),
    ("Cinema", "70.00", TransactionType.EXPENSE, "Lazer", "Conta Corrente", 5),
    ("Farmácia", "95.30", TransactionType.EXPENSE, "Saúde", "Conta Corrente", 2),
]


def seed() -> None:
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        if db.scalar(select(Account).limit(1)):
            print("Database already has data; skipping seed.")
            return

        categories = {
            name: Category(name=name, color=color, icon=icon) for name, color, icon in CATEGORIES
        }
        accounts = {
            name: Account(name=name, initial_balance=Decimal(balance), bank=bank)
            for name, balance, bank in ACCOUNTS
        }
        db.add_all([*categories.values(), *accounts.values()])

        today = date.today()
        for description, amount, tx_type, category, account, days_ago in TRANSACTIONS:
            # Clamp to the current month so the dashboard always shows the sample data.
            tx_date = max(today - timedelta(days=days_ago), today.replace(day=1))
            db.add(
                Transaction(
                    description=description,
                    amount=Decimal(amount),
                    type=tx_type,
                    date=tx_date,
                    category=categories[category],
                    account=accounts[account],
                )
            )
        db.commit()
        print("Sample data created.")


if __name__ == "__main__":
    seed()
