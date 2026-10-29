import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import {
  ApiError,
  addBudgetItem,
  deleteBudgetItem,
  fetchTransactions,
  updateBudgetItem,
  updateTransaction,
  type Account,
  type Budget,
  type BudgetItem,
  type Category,
  type Transaction,
} from "../api/client";
import { formatCurrency, formatDate, formatMonth } from "../lib/format";
import BudgetProgress from "./BudgetProgress";
import CategoryLabel from "./CategoryLabel";
import { TrashIcon } from "./icons";
import MoneyInput from "./MoneyInput";

const ITEM_SUGGESTIONS = [
  "Cartão de crédito",
  "Assinaturas",
  "Taxas",
  "Mercado",
  "Moradia",
  "Transporte",
  "Lazer",
  "Saúde",
  "Educação",
];

interface Props {
  budget: Budget;
  accounts: Account[];
  categories: Category[];
  onChange: (budget: Budget) => void;
  /** Re-fetch the budget (e.g. after an expense is linked, changing spent totals). */
  onRefresh: () => void;
  onSaveTemplate: () => void;
  onDelete: () => void;
}

function ItemRow({
  item,
  budget,
  onChange,
}: {
  item: BudgetItem;
  budget: Budget;
  onChange: (b: Budget) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [planned, setPlanned] = useState(item.planned);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      onChange(await updateBudgetItem(budget.id, item.id, { name: name.trim(), planned }));
      setEditing(false);
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? "Já existe um item com esse nome."
          : "Não foi possível salvar.",
      );
    }
  }

  async function remove() {
    const ok = window.confirm(
      `Remover "${item.name}" do orçamento? As despesas associadas continuam lançadas, ` +
        "mas saem do orçamento.",
    );
    if (ok) onChange(await deleteBudgetItem(budget.id, item.id));
  }

  if (editing) {
    return (
      <li className="budget-item">
        <form className="inline-form" onSubmit={save} aria-label={`Editar ${item.name}`}>
          <label className="field grow">
            <span>Nome</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          </label>
          <label className="field">
            <span>Valor planejado</span>
            <MoneyInput value={planned} onChange={setPlanned} currency={budget.currency} />
          </label>
          <button type="button" className="button" onClick={() => setEditing(false)}>
            Cancelar
          </button>
          <button type="submit" className="button primary" disabled={!name.trim() || planned === ""}>
            Salvar
          </button>
        </form>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </li>
    );
  }

  return (
    <li className="budget-item">
      <div className="budget-item-header">
        <strong className="grow">{item.name}</strong>
        <button type="button" className="link-button" onClick={() => setEditing(true)}>
          Editar
        </button>
        <button
          type="button"
          className="icon-button danger"
          onClick={remove}
          aria-label={`Remover ${item.name}`}
          title="Remover"
        >
          <TrashIcon />
        </button>
      </div>
      <BudgetProgress
        planned={item.planned}
        spent={item.spent}
        available={item.available}
        currency={budget.currency}
        label={`Gasto em ${item.name}`}
      />
    </li>
  );
}

export default function BudgetDetail({
  budget,
  accounts,
  categories,
  onChange,
  onRefresh,
  onSaveTemplate,
  onDelete,
}: Props) {
  const [name, setName] = useState("");
  const [planned, setPlanned] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [expenses, setExpenses] = useState<Transaction[] | null>(null);

  const accountsById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const categoriesById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const title = formatMonth(budget.year, budget.month);

  useEffect(() => {
    const controller = new AbortController();
    fetchTransactions(
      { year: budget.year, month: budget.month, currency: budget.currency },
      controller.signal,
    )
      .then((txs) => setExpenses(txs.filter((t) => t.type === "expense")))
      .catch(() => !controller.signal.aborted && setExpenses([]));
    return () => controller.abort();
  }, [budget.id, budget.year, budget.month, budget.currency]);

  async function handleAddItem(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || planned === "") return;
    try {
      onChange(await addBudgetItem(budget.id, { name: trimmed, planned }));
      setName("");
      setPlanned("");
      setFormError(null);
    } catch (err) {
      setFormError(
        err instanceof ApiError && err.status === 409
          ? "Já existe um item com esse nome neste orçamento."
          : "Não foi possível adicionar o item.",
      );
    }
  }

  async function handleAssign(tx: Transaction, value: string) {
    const budgetItemId = value ? Number(value) : null;
    const updated = await updateTransaction(tx.id, { budget_item_id: budgetItemId });
    setExpenses((prev) => prev?.map((t) => (t.id === updated.id ? updated : t)) ?? null);
    onRefresh();
  }

  const unassignedCount = expenses?.filter((t) => t.budget_item_id === null).length ?? 0;

  return (
    <div className="budget-detail">
      <header className="page-header-row">
        <div>
          <h2 className="section-title">Orçamento de {title}</h2>
          <p className="muted">Valores em {budget.currency}</p>
        </div>
        <div className="button-row">
          <button
            type="button"
            className="button"
            onClick={onSaveTemplate}
            disabled={budget.items.length === 0}
            title={budget.items.length === 0 ? "Adicione itens antes de salvar" : undefined}
          >
            Salvar como modelo
          </button>
          <button type="button" className="button danger" onClick={onDelete}>
            Excluir orçamento
          </button>
        </div>
      </header>

      <section className="stat-row" aria-label="Resumo do orçamento">
        <div className="card stat">
          <span className="muted">Planejado</span>
          <strong>{formatCurrency(budget.planned, budget.currency)}</strong>
        </div>
        <div className="card stat">
          <span className="muted">Gasto</span>
          <strong>{formatCurrency(budget.spent, budget.currency)}</strong>
        </div>
        <div className="card stat">
          <span className="muted">Disponível</span>
          <strong className={Number(budget.available) < 0 ? "negative" : undefined}>
            {formatCurrency(budget.available, budget.currency)}
          </strong>
        </div>
      </section>

      <section className="card" aria-labelledby="budget-items-title">
        <h3 id="budget-items-title" className="card-title">
          Categorias do orçamento
        </h3>
        {budget.items.length === 0 ? (
          <p className="empty">
            Nenhuma categoria ainda. Adicione abaixo, por exemplo: Cartão de crédito, Assinaturas,
            Taxas.
          </p>
        ) : (
          <ul className="budget-item-list">
            {budget.items.map((item) => (
              <ItemRow key={item.id} item={item} budget={budget} onChange={onChange} />
            ))}
          </ul>
        )}

        <form className="inline-form add-item-form" onSubmit={handleAddItem}>
          <label className="field grow">
            <span>Nova categoria</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              placeholder="Ex.: Assinaturas"
              list="budget-item-suggestions"
            />
            <datalist id="budget-item-suggestions">
              {ITEM_SUGGESTIONS.filter((s) => !budget.items.some((i) => i.name === s)).map(
                (s) => (
                  <option key={s} value={s} />
                ),
              )}
            </datalist>
          </label>
          <label className="field">
            <span>Valor planejado</span>
            <MoneyInput value={planned} onChange={setPlanned} currency={budget.currency} />
          </label>
          <button
            type="submit"
            className="button primary"
            disabled={!name.trim() || planned === ""}
          >
            Adicionar
          </button>
        </form>
        {formError && (
          <p role="alert" className="error">
            {formError}
          </p>
        )}
      </section>

      <section className="card" aria-labelledby="budget-expenses-title">
        <div className="card-header">
          <h3 id="budget-expenses-title" className="card-title">
            Despesas de {title}
          </h3>
          <Link to="/lancamentos?nova=1" className="link-button">
            + Novo lançamento
          </Link>
        </div>
        {expenses === null && <p className="muted">Carregando…</p>}
        {expenses?.length === 0 && (
          <p className="empty">Nenhuma despesa em {budget.currency} neste mês.</p>
        )}
        {expenses && expenses.length > 0 && (
          <>
            {unassignedCount > 0 && budget.items.length > 0 && (
              <p className="hint">
                {unassignedCount === 1
                  ? "1 despesa ainda não está associada ao orçamento."
                  : `${unassignedCount} despesas ainda não estão associadas ao orçamento.`}
              </p>
            )}
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Data</th>
                    <th scope="col">Descrição</th>
                    <th scope="col">Categoria</th>
                    <th scope="col">Conta</th>
                    <th scope="col" className="num">
                      Valor
                    </th>
                    <th scope="col">Item do orçamento</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((tx) => {
                    const category =
                      tx.category_id !== null ? categoriesById.get(tx.category_id) : undefined;
                    return (
                      <tr key={tx.id}>
                        <td className="nowrap">{formatDate(tx.date)}</td>
                        <td>{tx.description}</td>
                        <td>
                          {category ? (
                            <CategoryLabel
                              name={category.name}
                              color={category.color}
                              icon={category.icon}
                            />
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td>{accountsById.get(tx.account_id)?.name ?? "—"}</td>
                        <td className="value nowrap">
                          {formatCurrency(tx.amount, budget.currency)}
                        </td>
                        <td>
                          <select
                            className="compact-select"
                            aria-label={`Item do orçamento para ${tx.description}`}
                            value={tx.budget_item_id ?? ""}
                            onChange={(e) => handleAssign(tx, e.target.value)}
                            disabled={budget.items.length === 0}
                          >
                            <option value="">Fora do orçamento</option>
                            {budget.items.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
