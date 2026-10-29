import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  deleteTransaction,
  fetchAccounts,
  fetchBudgets,
  fetchCategories,
  fetchMonthlyTotals,
  fetchTransactions,
  updateTransaction,
  type Account,
  type Budget,
  type Category,
  type Currency,
  type MonthTotals,
  type Transaction,
} from "../api/client";
import CategoryLabel from "../components/CategoryLabel";
import { EditIcon, TrashIcon } from "../components/icons";
import TransactionForm from "../components/TransactionForm";
import { budgetFor } from "../lib/budgets";
import { formatCurrency, formatDate, formatMonth, monthName } from "../lib/format";
import { UNCATEGORIZED_COLOR } from "../lib/options";

const WHOLE_YEAR = 0;

type Records =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; transactions: Transaction[]; months: MonthTotals[] };

function yearOptions(current: number): number[] {
  return Array.from({ length: 7 }, (_, i) => current + 1 - i);
}

export default function Transactions() {
  const today = new Date();
  const [searchParams, setSearchParams] = useSearchParams();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [currency, setCurrency] = useState<Currency>("BRL");
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [records, setRecords] = useState<Records>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const showForm = searchParams.get("nova") === "1";

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetchAccounts(controller.signal),
      fetchCategories(controller.signal),
      fetchBudgets(controller.signal),
    ])
      .then(([accs, cats, buds]) => {
        setAccounts(accs);
        setCategories(cats);
        setBudgets(buds);
      })
      .catch(() => !controller.signal.aborted && setRecords({ status: "error" }));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setRecords({ status: "loading" });
    Promise.all([
      fetchTransactions(
        { year, month: month === WHOLE_YEAR ? undefined : month, currency },
        controller.signal,
      ),
      fetchMonthlyTotals(year, currency, controller.signal),
    ])
      .then(([transactions, months]) => setRecords({ status: "ready", transactions, months }))
      .catch(() => !controller.signal.aborted && setRecords({ status: "error" }));
    return () => controller.abort();
  }, [year, month, currency, reloadKey]);

  const accountsById = useMemo(() => new Map(accounts?.map((a) => [a.id, a])), [accounts]);
  const categoriesById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const currencies = useMemo(
    () => [...new Set(accounts?.map((a) => a.currency) ?? [])].sort(),
    [accounts],
  );

  function setShowForm(open: boolean) {
    setEditing(null);
    setSearchParams(open ? { nova: "1" } : {}, { replace: true });
  }

  function startEditing(tx: Transaction) {
    setSearchParams({}, { replace: true });
    setNotice(null);
    setEditing(tx);
    // The form opens above the filters; bring it into view.
    requestAnimationFrame(() =>
      document.getElementById("transaction-form-title")?.scrollIntoView({ block: "center" }),
    );
  }

  function handleSaved(tx: Transaction) {
    const verb = editing ? "atualizado" : "adicionado";
    const account = accountsById.get(tx.account_id);
    const [txYear, txMonth] = tx.date.split("-").map(Number);
    const visible =
      account?.currency === currency &&
      txYear === year &&
      (month === WHOLE_YEAR || txMonth === month);
    setNotice(
      visible
        ? `Lançamento ${verb}.`
        : `Lançamento ${verb} em ${formatMonth(txYear, txMonth)}` +
            (account && account.currency !== currency ? ` (${account.currency})` : "") +
            ".",
    );
    setEditing(null);
    setReloadKey((k) => k + 1);
  }

  async function changeBudgetLink(tx: Transaction, budgetItemId: number | null) {
    try {
      const saved = await updateTransaction(tx.id, {
        budget_item_id: budgetItemId,
      });
      setNotice(null);
      setRecords((current) =>
        current.status === "ready"
          ? {
              ...current,
              transactions: current.transactions.map((t) => (t.id === saved.id ? saved : t)),
            }
          : current,
      );
    } catch {
      setNotice("Não foi possível alterar a categoria do orçamento.");
    }
  }

  async function handleDelete(tx: Transaction) {
    if (!window.confirm(`Excluir o lançamento "${tx.description}"?`)) return;
    try {
      await deleteTransaction(tx.id);
      setNotice(null);
      setReloadKey((k) => k + 1);
    } catch {
      setNotice("Não foi possível excluir o lançamento.");
    }
  }

  const periodTotals =
    records.status === "ready"
      ? (month === WHOLE_YEAR
          ? records.months
          : records.months.filter((m) => m.month === month)
        ).reduce(
          (acc, m) => ({
            income: acc.income + Number(m.income),
            expense: acc.expense + Number(m.expense),
          }),
          { income: 0, expense: 0 },
        )
      : null;

  const periodLabel = month === WHOLE_YEAR ? `Ano de ${year}` : formatMonth(year, month);

  return (
    <div className="page">
      <header className="page-header page-header-row">
        <div>
          <h1>Lançamentos</h1>
          <p className="muted">Despesas e receitas por mês e por ano.</p>
        </div>
        {!showForm && !editing && (
          <button type="button" className="button primary" onClick={() => setShowForm(true)}>
            + Novo lançamento
          </button>
        )}
      </header>

      {(showForm || editing) && accounts && (
        <TransactionForm
          // A fresh form per transaction, so its fields start from that transaction.
          key={editing?.id ?? "new"}
          accounts={accounts}
          categories={categories}
          budgets={budgets}
          years={yearOptions(today.getFullYear())}
          initialYear={year}
          initialMonth={month === WHOLE_YEAR ? today.getMonth() + 1 : month}
          transaction={editing ?? undefined}
          onSaved={handleSaved}
          onCancel={() => (editing ? setEditing(null) : setShowForm(false))}
        />
      )}

      <div className="filters" role="group" aria-label="Período">
        <label className="field" htmlFor="filter-month">
          <span>Mês</span>
          <select
            id="filter-month"
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
          >
            <option value={WHOLE_YEAR}>Ano inteiro</option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {monthName(m)}
              </option>
            ))}
          </select>
        </label>
        <label className="field" htmlFor="filter-year">
          <span>Ano</span>
          <select id="filter-year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {yearOptions(today.getFullYear()).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        {currencies.length > 1 && (
          <label className="field" htmlFor="filter-currency">
            <span>Moeda</span>
            <select
              id="filter-currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency)}
            >
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}

      {records.status === "loading" && <p className="muted">Carregando…</p>}
      {records.status === "error" && (
        <p role="alert" className="error">
          Não foi possível carregar os lançamentos.
        </p>
      )}

      {records.status === "ready" && periodTotals && (
        <>
          <section className="stat-row" aria-label={`Resumo: ${periodLabel}`}>
            <div className="card stat">
              <span className="muted">Receitas</span>
              <strong className="positive">{formatCurrency(periodTotals.income, currency)}</strong>
            </div>
            <div className="card stat">
              <span className="muted">Despesas</span>
              <strong className="negative">{formatCurrency(periodTotals.expense, currency)}</strong>
            </div>
            <div className="card stat">
              <span className="muted">Saldo do período</span>
              <strong>
                {formatCurrency(periodTotals.income - periodTotals.expense, currency)}
              </strong>
            </div>
          </section>

          {month === WHOLE_YEAR && (
            <section className="card" aria-labelledby="months-title">
              <h2 id="months-title" className="card-title">
                Resumo mensal de {year}
              </h2>
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Mês</th>
                    <th scope="col" className="num">
                      Receitas
                    </th>
                    <th scope="col" className="num">
                      Despesas
                    </th>
                    <th scope="col" className="num">
                      Saldo
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {records.months.map((m) => {
                    const net = Number(m.income) - Number(m.expense);
                    return (
                      <tr key={m.month}>
                        <td>
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => setMonth(m.month)}
                            title={`Ver lançamentos de ${monthName(m.month)}`}
                          >
                            {monthName(m.month)}
                          </button>
                        </td>
                        <td className="value">{formatCurrency(m.income, currency)}</td>
                        <td className="value">{formatCurrency(m.expense, currency)}</td>
                        <td className={net < 0 ? "value negative" : "value"}>
                          {formatCurrency(net, currency)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}

          <section className="card" aria-labelledby="records-title">
            <h2 id="records-title" className="card-title">
              Registros — {periodLabel}
            </h2>
            {records.transactions.length === 0 ? (
              <p className="empty">Nenhum lançamento neste período.</p>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Data</th>
                      <th scope="col">Descrição</th>
                      <th scope="col">Categoria</th>
                      <th scope="col">Conta</th>
                      <th scope="col">Orçamento</th>
                      <th scope="col" className="num">
                        Valor
                      </th>
                      <th scope="col">
                        <span className="visually-hidden">Ações</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.transactions.map((tx) => {
                      const category =
                        tx.category_id !== null ? categoriesById.get(tx.category_id) : undefined;
                      const isIncome = tx.type === "income";
                      const [txYear, txMonth] = tx.date.split("-").map(Number);
                      const budget = isIncome
                        ? undefined
                        : budgetFor(
                            budgets,
                            txYear,
                            txMonth,
                            accountsById.get(tx.account_id)?.currency,
                          );
                      return (
                        <tr key={tx.id}>
                          <td className="nowrap">{formatDate(tx.date)}</td>
                          <td>{tx.description}</td>
                          <td>
                            <CategoryLabel
                              name={category?.name ?? "Sem categoria"}
                              color={category?.color ?? UNCATEGORIZED_COLOR}
                              icon={category?.icon}
                            />
                          </td>
                          <td>{accountsById.get(tx.account_id)?.name ?? "—"}</td>
                          <td>
                            {budget && budget.items.length > 0 ? (
                              <select
                                className="compact-select budget-link-select"
                                aria-label={`Categoria do orçamento de ${tx.description}`}
                                value={tx.budget_item_id ?? ""}
                                onChange={(e) =>
                                  changeBudgetLink(
                                    tx,
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
                            ) : (
                              <span
                                className="muted"
                                title={
                                  isIncome
                                    ? "Receitas não entram no orçamento"
                                    : "Sem orçamento neste mês"
                                }
                              >
                                —
                              </span>
                            )}
                          </td>
                          <td
                            className={isIncome ? "value positive nowrap" : "value negative nowrap"}
                          >
                            {isIncome ? "+ " : "− "}
                            {formatCurrency(tx.amount, currency)}
                          </td>
                          <td className="row-actions">
                            <button
                              type="button"
                              className="icon-button"
                              onClick={() => startEditing(tx)}
                              aria-label={`Editar ${tx.description}`}
                              title="Editar"
                            >
                              <EditIcon />
                            </button>
                            <button
                              type="button"
                              className="icon-button danger"
                              onClick={() => handleDelete(tx)}
                              aria-label={`Excluir ${tx.description}`}
                              title="Excluir"
                            >
                              <TrashIcon />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
