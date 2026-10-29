import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";

import {
  fetchMonthlyTotals,
  type Currency,
  type MonthTotals,
} from "../api/client";
import {
  formatCurrency,
  formatCurrencyRounded,
  monthName,
} from "../lib/format";

const SERIES = [
  { key: "income", label: "Receitas", color: "var(--positive)" },
  { key: "expense", label: "Despesas", color: "var(--negative)" },
] as const;

interface Row {
  month: number;
  label: string;
  income: number;
  expense: number;
}

function toRows(totals: MonthTotals[]): Row[] {
  return totals.map((t) => ({
    month: t.month,
    label: monthName(t.month).slice(0, 3),
    income: Number(t.income),
    expense: Number(t.expense),
  }));
}

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; rows: Row[]; year: number; currency: Currency };

interface Props {
  years: number[];
  availableCurrencies: Currency[];
}

export default function IncomeExpenseChart({
  years,
  availableCurrencies,
}: Props) {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [currency, setCurrency] = useState<Currency>(
    availableCurrencies[0] ?? "BRL",
  );
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetchMonthlyTotals(year, currency, controller.signal)
      .then((totals) =>
        setState({ status: "ready", rows: toRows(totals), year, currency }),
      )
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.error(error);
          setState({ status: "error" });
        }
      });
    return () => controller.abort();
  }, [year, currency]);

  function MonthTooltip({ active, payload }: TooltipProps<number, string>) {
    const row = payload?.[0]?.payload as Row | undefined;
    if (!active || !row || state.status !== "ready") return null;
    const balance = row.income - row.expense;
    return (
      <div className="chart-tooltip chart-tooltip-stack">
        <strong>{monthName(row.month)}</strong>
        {SERIES.map((s) => (
          <span key={s.key}>
            <span className="swatch" style={{ background: s.color }} />
            {s.label}: {formatCurrency(row[s.key], state.currency)}
          </span>
        ))}
        <span className="muted">
          Saldo: {formatCurrency(balance, state.currency)}
        </span>
      </div>
    );
  }

  const ready = state.status === "ready" ? state : null;
  const totalIncome = ready?.rows.reduce((sum, r) => sum + r.income, 0) ?? 0;
  const totalExpense = ready?.rows.reduce((sum, r) => sum + r.expense, 0) ?? 0;
  const balance = totalIncome - totalExpense;

  return (
    <section className="card span-all" aria-labelledby="income-expense-title">
      <div className="card-header">
        <h2 id="income-expense-title" className="card-title">
          Receitas vs despesas
        </h2>
        <div className="card-actions">
          <select
            className="compact-select"
            aria-label="Ano do gráfico de receitas e despesas"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          {availableCurrencies.length > 1 && (
            <select
              className="compact-select"
              aria-label="Moeda do gráfico de receitas e despesas"
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency)}
            >
              {availableCurrencies.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {state.status === "loading" && <p className="muted">Carregando…</p>}
      {state.status === "error" && (
        <p role="alert" className="error">
          Não foi possível carregar receitas e despesas.
        </p>
      )}
      {ready && totalIncome === 0 && totalExpense === 0 && (
        <p className="empty">Nenhum lançamento em {ready.year}.</p>
      )}

      {ready && (totalIncome > 0 || totalExpense > 0) && (
        <>
          <p
            className="budget-chart-summary"
            data-testid="income-expense-totals"
          >
            <span className="muted">Receitas </span>
            <strong className="positive">
              {formatCurrency(totalIncome, ready.currency)}
            </strong>
            <span className="muted"> · Despesas </span>
            <strong className="negative">
              {formatCurrency(totalExpense, ready.currency)}
            </strong>
            <span className="muted"> · Saldo do ano </span>
            <strong className={balance < 0 ? "negative" : undefined}>
              {formatCurrency(balance, ready.currency)}
            </strong>
          </p>

          <div
            className="income-expense-chart"
            role="img"
            aria-label={`Receitas e despesas por mês em ${ready.year}`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={ready.rows}
                margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
                barGap={2}
                barCategoryGap="20%"
              >
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(v: number) =>
                    formatCurrencyRounded(v, ready.currency)
                  }
                  tick={{ fill: "var(--text-muted)", fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  width={88}
                />
                <Tooltip
                  content={<MonthTooltip />}
                  cursor={{ fill: "var(--bg)" }}
                />
                {SERIES.map((s) => (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    name={s.label}
                    fill={s.color}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={18}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>

          <ul className="status-legend" aria-label="Legenda">
            {SERIES.map((s) => (
              <li key={s.key}>
                <span className="swatch" style={{ background: s.color }} />
                {s.label}
              </li>
            ))}
          </ul>

          {/* Text view of the chart for screen readers; a table ignores a 1px height. */}
          <div className="visually-hidden">
            <table>
              <caption>Receitas e despesas por mês em {ready.year}</caption>
              <thead>
                <tr>
                  <th scope="col">Mês</th>
                  <th scope="col">Receitas</th>
                  <th scope="col">Despesas</th>
                  <th scope="col">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {ready.rows.map((r) => (
                  <tr key={r.month}>
                    <td>{monthName(r.month)}</td>
                    <td>{formatCurrency(r.income, ready.currency)}</td>
                    <td>{formatCurrency(r.expense, ready.currency)}</td>
                    <td>
                      {formatCurrency(r.income - r.expense, ready.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
