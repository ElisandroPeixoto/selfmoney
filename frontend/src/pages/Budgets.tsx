import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { NavLink, useNavigate, useParams } from "react-router-dom";

import {
  ApiError,
  createBudget,
  deleteBudget,
  deleteBudgetTemplate,
  fetchAccounts,
  fetchBudget,
  fetchBudgets,
  fetchBudgetTemplates,
  fetchCategories,
  saveBudgetAsTemplate,
  type Account,
  type Budget,
  type BudgetTemplate,
  type Category,
  type Currency,
} from "../api/client";
import BudgetDetail from "../components/BudgetDetail";
import BudgetProgress from "../components/BudgetProgress";
import { TrashIcon } from "../components/icons";
import { formatMonth, monthName } from "../lib/format";

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

function yearOptions(current: number): number[] {
  return Array.from({ length: 5 }, (_, i) => current - 1 + i);
}

/** "template:3" or "budget:7" or "" (start empty). */
type Source = string;

function NewBudgetForm({
  budgets,
  templates,
  currencies,
  onCreated,
}: {
  budgets: Budget[];
  templates: BudgetTemplate[];
  currencies: Currency[];
  onCreated: (budget: Budget) => void;
}) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [currency, setCurrency] = useState<Currency>("BRL");
  const [source, setSource] = useState<Source>("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const [kind, id] = source.split(":");
    setSaving(true);
    setError(null);
    try {
      const created = await createBudget({
        year,
        month,
        currency,
        template_id: kind === "template" ? Number(id) : null,
        source_budget_id: kind === "budget" ? Number(id) : null,
      });
      onCreated(created);
      setSource("");
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? `${formatMonth(year, month)} já tem um orçamento.`
          : "Não foi possível criar o orçamento.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card" aria-labelledby="new-budget-title">
      <h2 id="new-budget-title" className="card-title">
        Novo orçamento
      </h2>
      <form onSubmit={handleSubmit} aria-label="Novo orçamento" className="stack-form">
        <div className="form-grid two">
          <label className="field" htmlFor="budget-month">
            <span>Mês</span>
            <select
              id="budget-month"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
            >
              {MONTHS.map((m) => (
                <option key={m} value={m}>
                  {monthName(m)}
                </option>
              ))}
            </select>
          </label>
          <label className="field" htmlFor="budget-year">
            <span>Ano</span>
            <select id="budget-year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {yearOptions(today.getFullYear()).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        </div>
        {currencies.length > 1 && (
          <label className="field" htmlFor="budget-currency">
            <span>Moeda</span>
            <select
              id="budget-currency"
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
        <label className="field" htmlFor="budget-source">
          <span>Começar com</span>
          <select id="budget-source" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">Orçamento em branco</option>
            {templates.length > 0 && (
              <optgroup label="Modelos salvos">
                {templates.map((t) => (
                  <option key={t.id} value={`template:${t.id}`}>
                    {t.name}
                  </option>
                ))}
              </optgroup>
            )}
            {budgets.length > 0 && (
              <optgroup label="Copiar a estrutura de">
                {budgets.map((b) => (
                  <option key={b.id} value={`budget:${b.id}`}>
                    {formatMonth(b.year, b.month)}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button type="submit" className="button primary" disabled={saving}>
          Criar orçamento
        </button>
      </form>
    </section>
  );
}

export default function Budgets() {
  const { budgetId } = useParams();
  const navigate = useNavigate();
  const selectedId = budgetId ? Number(budgetId) : null;

  const [budgets, setBudgets] = useState<Budget[] | null>(null);
  const [templates, setTemplates] = useState<BudgetTemplate[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selected, setSelected] = useState<Budget | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    Promise.all([
      fetchBudgets(signal),
      fetchBudgetTemplates(signal),
      fetchAccounts(signal),
      fetchCategories(signal),
    ])
      .then(([b, t, a, c]) => {
        setBudgets(b);
        setTemplates(t);
        setAccounts(a);
        setCategories(c);
      })
      .catch(() => !signal.aborted && setLoadError(true));
    return () => controller.abort();
  }, []);

  const updateBudget = useCallback((budget: Budget) => {
    setSelected(budget);
    setBudgets((prev) => prev?.map((b) => (b.id === budget.id ? budget : b)) ?? prev);
  }, []);

  const loadSelected = useCallback(
    (signal?: AbortSignal) => {
      if (selectedId === null) {
        setSelected(null);
        return;
      }
      fetchBudget(selectedId, signal)
        .then(updateBudget)
        .catch((err) => {
          if (signal?.aborted) return;
          if (err instanceof ApiError && err.status === 404) navigate("/orcamentos", { replace: true });
          else setLoadError(true);
        });
    },
    [selectedId, navigate, updateBudget],
  );

  useEffect(() => {
    const controller = new AbortController();
    loadSelected(controller.signal);
    return () => controller.abort();
  }, [loadSelected]);

  function handleCreated(budget: Budget) {
    setBudgets((prev) =>
      [...(prev ?? []), budget].sort((a, b) => b.year - a.year || b.month - a.month),
    );
    setNotice(null);
    navigate(`/orcamentos/${budget.id}`);
  }

  async function handleSaveTemplate() {
    if (!selected) return;
    const name = window.prompt(
      "Nome do modelo:",
      `Modelo de ${formatMonth(selected.year, selected.month)}`,
    );
    if (!name?.trim()) return;
    try {
      const template = await saveBudgetAsTemplate(selected.id, name.trim());
      setTemplates((prev) => [...prev, template].sort((a, b) => a.name.localeCompare(b.name)));
      setNotice(`Modelo "${template.name}" salvo. Use-o ao criar o orçamento de outro mês.`);
    } catch (err) {
      setNotice(
        err instanceof ApiError && err.status === 409
          ? "Já existe um modelo com esse nome."
          : "Não foi possível salvar o modelo.",
      );
    }
  }

  async function handleDeleteBudget() {
    if (!selected) return;
    const label = formatMonth(selected.year, selected.month);
    const ok = window.confirm(
      `Excluir o orçamento de ${label}? As despesas continuam lançadas, só deixam de ` +
        "estar associadas ao orçamento.",
    );
    if (!ok) return;
    await deleteBudget(selected.id);
    setBudgets((prev) => prev?.filter((b) => b.id !== selected.id) ?? prev);
    setNotice(`Orçamento de ${label} excluído.`);
    navigate("/orcamentos");
  }

  async function handleDeleteTemplate(template: BudgetTemplate) {
    if (!window.confirm(`Excluir o modelo "${template.name}"?`)) return;
    await deleteBudgetTemplate(template.id);
    setTemplates((prev) => prev.filter((t) => t.id !== template.id));
  }

  const currencies = useMemo(
    () => [...new Set(accounts.map((a) => a.currency))].sort() as Currency[],
    [accounts],
  );

  return (
    <div className="page">
      <header className="page-header">
        <h1>Orçamentos</h1>
        <p className="muted">
          Planeje quanto gastar em cada categoria do mês e acompanhe quanto ainda está disponível.
        </p>
      </header>

      {loadError && (
        <p role="alert" className="error">
          Não foi possível carregar os orçamentos.
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}

      <div className="budgets-layout">
        <div className="budgets-sidebar">
          {budgets && (
            <NewBudgetForm
              budgets={budgets}
              templates={templates}
              currencies={currencies}
              onCreated={handleCreated}
            />
          )}

          <section className="card" aria-labelledby="budget-list-title">
            <h2 id="budget-list-title" className="card-title">
              Seus orçamentos
            </h2>
            {budgets === null && !loadError && <p className="muted">Carregando…</p>}
            {budgets?.length === 0 && <p className="empty">Nenhum orçamento criado.</p>}
            {budgets && budgets.length > 0 && (
              <ul className="budget-list">
                {budgets.map((b) => (
                  <li key={b.id}>
                    <NavLink to={`/orcamentos/${b.id}`} className="budget-link">
                      <strong>{formatMonth(b.year, b.month)}</strong>
                      <BudgetProgress
                        planned={b.planned}
                        spent={b.spent}
                        available={b.available}
                        currency={b.currency}
                        label={`Gasto do orçamento de ${formatMonth(b.year, b.month)}`}
                      />
                    </NavLink>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card" aria-labelledby="template-list-title">
            <h2 id="template-list-title" className="card-title">
              Modelos salvos
            </h2>
            {templates.length === 0 ? (
              <p className="empty">
                Monte um orçamento e use “Salvar como modelo” para reutilizá-lo em outros meses.
              </p>
            ) : (
              <ul className="item-list">
                {templates.map((t) => (
                  <li key={t.id} className="item-row">
                    <span className="grow">
                      {t.name}
                      <span className="muted">
                        {" "}
                        · {t.items.length} {t.items.length === 1 ? "categoria" : "categorias"}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="icon-button danger"
                      onClick={() => handleDeleteTemplate(t)}
                      aria-label={`Excluir modelo ${t.name}`}
                      title="Excluir modelo"
                    >
                      <TrashIcon />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="budgets-main">
          {selected ? (
            <BudgetDetail
              key={selected.id}
              budget={selected}
              accounts={accounts}
              categories={categories}
              onChange={updateBudget}
              onRefresh={() => loadSelected()}
              onSaveTemplate={handleSaveTemplate}
              onDelete={handleDeleteBudget}
            />
          ) : (
            selectedId === null && (
              <section className="card empty-state">
                <p className="empty">
                  Crie um orçamento para um mês ou selecione um da lista para ver e editar suas
                  categorias.
                </p>
              </section>
            )
          )}
        </div>
      </div>
    </div>
  );
}
