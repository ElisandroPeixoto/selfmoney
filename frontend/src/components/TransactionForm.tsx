import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import {
  createTransaction,
  updateTransaction,
  type Account,
  type Budget,
  type Category,
  type Transaction,
  type TransactionType,
} from "../api/client";
import { budgetFor } from "../lib/budgets";
import { daysInMonth, formatMonth, monthName, toIsoDate } from "../lib/format";
import MoneyInput from "./MoneyInput";

interface Props {
  accounts: Account[];
  categories: Category[];
  budgets: Budget[];
  years: number[];
  initialYear: number;
  initialMonth: number;
  /** When given, the form edits this transaction instead of creating a new one. */
  transaction?: Transaction;
  onSaved: (transaction: Transaction) => void;
  onCancel: () => void;
}

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

function defaultDay(year: number, month: number): number {
  const today = new Date();
  const isCurrentMonth =
    today.getFullYear() === year && today.getMonth() + 1 === month;
  return isCurrentMonth ? today.getDate() : 1;
}

export default function TransactionForm({
  accounts,
  categories,
  budgets,
  years,
  initialYear,
  initialMonth,
  transaction,
  onSaved,
  onCancel,
}: Props) {
  const editing = transaction !== undefined;
  const [txYear, txMonth, txDay] =
    transaction?.date.split("-").map(Number) ?? [];
  const [type, setType] = useState<TransactionType>(
    transaction?.type ?? "expense",
  );
  const [description, setDescription] = useState(
    transaction?.description ?? "",
  );
  const [amount, setAmount] = useState(transaction?.amount ?? "");
  const [year, setYear] = useState(txYear ?? initialYear);
  const [month, setMonth] = useState(txMonth ?? initialMonth);
  const [day, setDay] = useState(
    () => txDay ?? defaultDay(initialYear, initialMonth),
  );
  const [categoryId, setCategoryId] = useState<number | null>(
    transaction?.category_id ?? null,
  );
  const [accountId, setAccountId] = useState<number | null>(
    transaction?.account_id ?? accounts[0]?.id ?? null,
  );
  const [budgetItemId, setBudgetItemId] = useState<number | null>(
    transaction?.budget_item_id ?? null,
  );
  // An old transaction may fall outside the usual year range; keep its year selectable.
  const yearOptions = years.includes(year)
    ? years
    : [...years, year].sort((a, b) => b - a);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const maxDay = daysInMonth(year, month);
  const showCurrency = new Set(accounts.map((a) => a.currency)).size > 1;
  const isExpense = type === "expense";
  // Only categories of the selected type apply; switching type drops a now-invalid choice.
  const categoryOptions = categories.filter((c) => c.kind === type);
  const effectiveCategoryId = categoryOptions.some((c) => c.id === categoryId)
    ? categoryId
    : null;

  // An expense can count against the budget of its month, in its account's currency.
  const account = accounts.find((a) => a.id === accountId);
  const budget = isExpense
    ? budgetFor(budgets, year, month, account?.currency)
    : undefined;
  const effectiveBudgetItemId = budget?.items.some((i) => i.id === budgetItemId)
    ? budgetItemId
    : null;

  if (accounts.length === 0) {
    return (
      <section className="card">
        <p className="empty">
          Cadastre uma conta antes de adicionar lançamentos.{" "}
          <Link to="/contas">Ir para Contas</Link>
        </p>
      </section>
    );
  }

  function changePeriod(newYear: number, newMonth: number) {
    setYear(newYear);
    setMonth(newMonth);
    // Keep the day valid (e.g. 31 → 28 when switching to February).
    setDay((d) => Math.min(d, daysInMonth(newYear, newMonth)));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (accountId === null || Number(amount) <= 0 || !description.trim())
      return;
    setSaving(true);
    setError(null);
    const fields = {
      description: description.trim(),
      amount,
      type,
      date: toIsoDate(year, month, day),
      account_id: accountId,
      category_id: effectiveCategoryId,
      budget_item_id: effectiveBudgetItemId,
    };
    try {
      if (transaction) {
        onSaved(await updateTransaction(transaction.id, fields));
      } else {
        onSaved(await createTransaction(fields));
        setDescription("");
        setAmount("");
      }
    } catch {
      setError("Não foi possível salvar o lançamento.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card" aria-labelledby="transaction-form-title">
      <h2 id="transaction-form-title" className="card-title">
        {editing
          ? isExpense
            ? "Editar despesa"
            : "Editar receita"
          : isExpense
            ? "Nova despesa"
            : "Nova receita"}
      </h2>
      <form
        onSubmit={handleSubmit}
        aria-label={editing ? "Editar lançamento" : "Novo lançamento"}
      >
        <div className="segmented" role="radiogroup" aria-label="Tipo">
          {(
            [
              ["expense", "Despesa"],
              ["income", "Receita"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={type === value}
              className={type === value ? "segment active" : "segment"}
              onClick={() => setType(value)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="form-grid">
          <label className="field" htmlFor="tx-description">
            <span>Descrição</span>
            <input
              id="tx-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={200}
              placeholder={isExpense ? "Ex.: Supermercado" : "Ex.: Salário"}
              required
            />
          </label>
          <label className="field" htmlFor="tx-amount">
            <span>Valor</span>
            <MoneyInput
              id="tx-amount"
              value={amount}
              onChange={setAmount}
              currency={account?.currency}
              required
            />
          </label>
          <label className="field" htmlFor="tx-month">
            <span>Mês</span>
            <select
              id="tx-month"
              value={month}
              onChange={(e) => changePeriod(year, Number(e.target.value))}
            >
              {MONTHS.map((m) => (
                <option key={m} value={m}>
                  {monthName(m)}
                </option>
              ))}
            </select>
          </label>
          <label className="field" htmlFor="tx-year">
            <span>Ano</span>
            <select
              id="tx-year"
              value={year}
              onChange={(e) => changePeriod(Number(e.target.value), month)}
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <label className="field" htmlFor="tx-day">
            <span>Dia</span>
            <input
              id="tx-day"
              type="number"
              min={1}
              max={maxDay}
              value={day}
              onChange={(e) =>
                setDay(
                  Math.max(1, Math.min(maxDay, Number(e.target.value) || 1)),
                )
              }
            />
          </label>
          <label className="field" htmlFor="tx-category">
            <span>Categoria</span>
            <select
              id="tx-category"
              value={effectiveCategoryId ?? ""}
              onChange={(e) =>
                setCategoryId(e.target.value ? Number(e.target.value) : null)
              }
            >
              <option value="">Sem categoria</option>
              {categoryOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon ? `${c.icon} ${c.name}` : c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field" htmlFor="tx-account">
            <span>{isExpense ? "Saiu da conta" : "Entrou na conta"}</span>
            <select
              id="tx-account"
              value={accountId ?? ""}
              onChange={(e) => setAccountId(Number(e.target.value))}
              required
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {showCurrency ? `${a.name} (${a.currency})` : a.name}
                </option>
              ))}
            </select>
          </label>
          {budget && budget.items.length > 0 && (
            <label className="field" htmlFor="tx-budget-item">
              <span>Categoria do orçamento</span>
              <select
                id="tx-budget-item"
                value={effectiveBudgetItemId ?? ""}
                onChange={(e) =>
                  setBudgetItemId(
                    e.target.value ? Number(e.target.value) : null,
                  )
                }
              >
                <option value="">Fora do orçamento</option>
                {budget.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {/* Say why the budget link is unavailable instead of hiding it silently. */}
          {isExpense && (!budget || budget.items.length === 0) && (
            <div className="field">
              <span>Categoria do orçamento</span>
              <p className="field-note" data-testid="budget-link-note">
                {budget ? (
                  <>
                    O orçamento de {formatMonth(year, month)} não tem
                    categorias.{" "}
                    <Link to={`/orcamentos/${budget.id}`}>
                      Adicionar categorias
                    </Link>
                  </>
                ) : (
                  <>
                    Sem orçamento em {formatMonth(year, month)}
                    {showCurrency && account
                      ? ` (${account.currency})`
                      : ""}. <Link to="/orcamentos">Criar orçamento</Link>
                  </>
                )}
              </p>
            </div>
          )}
        </div>

        <div className="form-actions">
          {error && (
            <span role="alert" className="error">
              {error}
            </span>
          )}
          <button type="button" className="button" onClick={onCancel}>
            {editing ? "Cancelar" : "Fechar"}
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={saving || !description.trim() || Number(amount) <= 0}
          >
            {editing
              ? "Salvar alterações"
              : isExpense
                ? "Adicionar despesa"
                : "Adicionar receita"}
          </button>
        </div>
      </form>
    </section>
  );
}
