import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type LabelProps,
  type TooltipProps,
} from "recharts";

import type { Budget } from "../api/client";
import {
  currencySymbol,
  formatCurrency,
  formatCurrencyRounded,
  formatMonth,
} from "../lib/format";

/** Share of the planned amount at which an item counts as "near the limit". */
const NEAR_LIMIT = 0.8;

type Status = "ok" | "near" | "over";

/** Bars as share of each item's planned amount, or as money spent against the planned amount. */
type Mode = "percent" | "amount";

const MODES: { mode: Mode; label: string; title: string }[] = [
  { mode: "percent", label: "%", title: "Ver em percentual" },
  { mode: "amount", label: "R$", title: "Ver em valores" },
];

const STATUS: Record<Status, { label: string; glyph: string; color: string }> = {
  ok: { label: "Dentro do planejado", glyph: "", color: "var(--accent)" },
  near: { label: "Perto do limite", glyph: "⚠", color: "var(--status-warning)" },
  over: { label: "Limite excedido", glyph: "✕", color: "var(--status-critical)" },
};

interface Row {
  name: string;
  planned: number;
  spent: number;
  available: number;
  /** Spent as a share of planned (1 = at the limit). */
  ratio: number;
  status: Status;
}

function toRows(budget: Budget): Row[] {
  return budget.items.map((item) => {
    const planned = Number(item.planned);
    const spent = Number(item.spent);
    // Spending on an item planned at zero is already over its limit.
    const ratio = planned > 0 ? spent / planned : spent > 0 ? Infinity : 0;
    const status: Status = ratio > 1 ? "over" : ratio >= NEAR_LIMIT ? "near" : "ok";
    return { name: item.name, planned, spent, available: Number(item.available), ratio, status };
  });
}

/** Rounds up to 1, 2, 2.5 or 5 × 10ⁿ so the money axis gets round tick values. */
function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * magnitude >= value) ?? 10;
  return step * magnitude;
}

function percentText(ratio: number): string {
  return Number.isFinite(ratio) ? `${Math.round(ratio * 100)}%` : "—";
}

/** The budget of the current month if there is one, else the most recent. */
function defaultBudgetId(budgets: Budget[], today = new Date()): number | null {
  const current = budgets.find(
    (b) => b.year === today.getFullYear() && b.month === today.getMonth() + 1,
  );
  return (current ?? budgets[0])?.id ?? null;
}

interface Props {
  budgets: Budget[];
}

export default function BudgetChart({ budgets }: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(() => defaultBudgetId(budgets));
  const [mode, setMode] = useState<Mode>("percent");
  const budget = budgets.find((b) => b.id === selectedId) ?? null;
  const rows = budget ? toRows(budget) : [];
  const currency = budget?.currency ?? "BRL";

  // Leave room past 100% so overspent bars and the limit line stay readable.
  const maxRatio = Math.max(1, ...rows.map((r) => (Number.isFinite(r.ratio) ? r.ratio : 1.25)));
  const domainMax = Math.ceil(maxRatio * 1.15 * 10) / 10;
  const plotted = rows.map((r) => ({
    ...r,
    value: Math.min(r.ratio, domainMax),
    // Amount mode stacks: spent up to the limit, what is left of it, and any overspending.
    withinLimit: Math.min(r.spent, r.planned),
    remaining: Math.max(r.planned - r.spent, 0),
    overLimit: Math.max(r.spent - r.planned, 0),
  }));
  const amountMax = niceCeil(Math.max(...rows.map((r) => Math.max(r.planned, r.spent)), 0));
  const withinLimit = rows.filter((r) => r.status !== "over").length;

  function RowTooltip({ active, payload }: TooltipProps<number, string>) {
    const row = payload?.[0]?.payload as Row | undefined;
    if (!active || !row) return null;
    const meta = STATUS[row.status];
    return (
      <div className="chart-tooltip chart-tooltip-stack">
        <strong>{row.name}</strong>
        <span>
          {formatCurrency(row.spent, currency)} de {formatCurrency(row.planned, currency)} (
          {percentText(row.ratio)})
        </span>
        <span>
          {row.available < 0
            ? `Excedido em ${formatCurrency(-row.available, currency)}`
            : `Disponível: ${formatCurrency(row.available, currency)}`}
        </span>
        <span className="muted">
          {meta.glyph && `${meta.glyph} `}
          {meta.label}
        </span>
      </div>
    );
  }

  function ValueLabel(props: LabelProps) {
    const { x = 0, y = 0, width = 0, height = 0, index = 0 } = props;
    const row = rows[index];
    if (!row) return null;
    const glyph = STATUS[row.status].glyph;
    return (
      <text
        x={Number(x) + Number(width) + 6}
        y={Number(y) + Number(height) / 2}
        dominantBaseline="central"
        className="bar-value-label"
      >
        {glyph && `${glyph} `}
        {mode === "percent"
          ? percentText(row.ratio)
          : `${formatCurrencyRounded(row.spent, currency)} de ` +
            formatCurrencyRounded(row.planned, currency)}
      </text>
    );
  }

  return (
    <section className="card span-all" aria-labelledby="budget-chart-title">
      <div className="card-header">
        <h2 id="budget-chart-title" className="card-title">
          Orçamento por categoria
        </h2>
        {budgets.length > 0 && (
          <div className="card-actions">
            <div
              className="segmented segmented-small"
              role="group"
              aria-label="Unidade do gráfico"
            >
              {MODES.map((m) => (
                <button
                  key={m.mode}
                  type="button"
                  className={mode === m.mode ? "segment active" : "segment"}
                  aria-pressed={mode === m.mode}
                  aria-label={m.title}
                  title={m.title}
                  onClick={() => setMode(m.mode)}
                >
                  {m.mode === "amount" ? currencySymbol(currency) : m.label}
                </button>
              ))}
            </div>
            <select
              className="compact-select"
              aria-label="Orçamento exibido"
              value={selectedId ?? ""}
              onChange={(e) => setSelectedId(Number(e.target.value))}
            >
              {budgets.map((b) => (
                <option key={b.id} value={b.id}>
                  {formatMonth(b.year, b.month)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {budgets.length === 0 && (
        <p className="empty">
          Nenhum orçamento criado. <Link to="/orcamentos">Criar um orçamento</Link>
        </p>
      )}
      {budget && rows.length === 0 && (
        <p className="empty">
          Este orçamento ainda não tem categorias.{" "}
          <Link to={`/orcamentos/${budget.id}`}>Adicionar categorias</Link>
        </p>
      )}

      {budget && rows.length > 0 && (
        <>
          <p className="budget-chart-summary">
            <strong>{formatCurrency(budget.spent, currency)}</strong>
            <span className="muted"> gastos de {formatCurrency(budget.planned, currency)}</span>
            <span className="muted">
              {" "}
              · {withinLimit} de {rows.length}{" "}
              {rows.length === 1 ? "categoria" : "categorias"} dentro do limite
            </span>
          </p>

          <div
            className="budget-chart"
            style={{ height: rows.length * 44 + 36 }}
            role="img"
            aria-label={
              `Uso do orçamento de ${formatMonth(budget.year, budget.month)} por categoria, ` +
              (mode === "percent" ? "em percentual" : "em valores")
            }
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={plotted}
                layout="vertical"
                margin={{ top: 18, right: mode === "percent" ? 64 : 140, bottom: 4, left: 4 }}
                barCategoryGap={12}
              >
                {mode === "percent" ? (
                  <XAxis
                    type="number"
                    domain={[0, domainMax]}
                    tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
                    ticks={[0, 0.25, 0.5, 0.75, 1].filter((t) => t <= domainMax)}
                    tick={{ fill: "var(--text-muted)", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                  />
                ) : (
                  <XAxis
                    type="number"
                    domain={[0, amountMax]}
                    tickFormatter={(v: number) => formatCurrencyRounded(v, currency)}
                    ticks={[0, 0.25, 0.5, 0.75, 1].map((t) => t * amountMax)}
                    tick={{ fill: "var(--text-muted)", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                  />
                )}
                <YAxis
                  type="category"
                  dataKey="name"
                  width={140}
                  tick={{ fill: "var(--text-secondary)", fontSize: 13 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<RowTooltip />} cursor={{ fill: "var(--bg)" }} />
                {mode === "percent" && (
                  <Bar
                    dataKey="value"
                    barSize={14}
                    radius={[0, 4, 4, 0]}
                    background={{ fill: "var(--border)", radius: 4 }}
                    isAnimationActive={false}
                  >
                    {plotted.map((r) => (
                      <Cell key={r.name} fill={STATUS[r.status].color} />
                    ))}
                    <LabelList dataKey="value" content={<ValueLabel />} />
                  </Bar>
                )}
                {mode === "percent" && (
                  <ReferenceLine
                    x={1}
                    stroke="var(--text-secondary)"
                    strokeDasharray="4 3"
                    label={{
                      value: "Limite",
                      position: "top",
                      fill: "var(--text-muted)",
                      fontSize: 11,
                    }}
                  />
                )}
                {/* Each item's track is as long as its planned amount, so the end of the gray
                    part is that item's limit; a 2px surface stroke separates the segments. */}
                {mode === "amount" &&
                  (["withinLimit", "remaining", "overLimit"] as const).map((key) => (
                    <Bar
                      key={key}
                      dataKey={key}
                      stackId="amount"
                      barSize={14}
                      stroke="var(--surface)"
                      strokeWidth={2}
                      isAnimationActive={false}
                    >
                      {plotted.map((r) => (
                        <Cell
                          key={r.name}
                          fill={key === "remaining" ? "var(--border)" : STATUS[r.status].color}
                        />
                      ))}
                      {key === "overLimit" && (
                        <LabelList dataKey="overLimit" content={<ValueLabel />} />
                      )}
                    </Bar>
                  ))}
              </BarChart>
            </ResponsiveContainer>
          </div>

          <ul className="status-legend" aria-label="Legenda">
            {(Object.keys(STATUS) as Status[]).map((s) => (
              <li key={s}>
                <span className="swatch" style={{ background: STATUS[s].color }} />
                {STATUS[s].glyph && <span aria-hidden="true">{STATUS[s].glyph}</span>}
                {STATUS[s].label}
                {s === "near" && ` (a partir de ${Math.round(NEAR_LIMIT * 100)}%)`}
              </li>
            ))}
            {mode === "amount" && (
              <li>
                <span className="swatch" style={{ background: "var(--border)" }} />
                Restante até o limite
              </li>
            )}
          </ul>

          {/* Text view of the chart for screen readers. A table ignores a 1px height, so the
              hiding wrapper is a div. */}
          <div className="visually-hidden">
            <table>
              <caption>Uso do orçamento por categoria</caption>
              <thead>
                <tr>
                  <th scope="col">Categoria</th>
                  <th scope="col">Gasto</th>
                  <th scope="col">Planejado</th>
                  <th scope="col">Uso</th>
                  <th scope="col">Situação</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name}>
                    <td>{r.name}</td>
                    <td>{formatCurrency(r.spent, currency)}</td>
                    <td>{formatCurrency(r.planned, currency)}</td>
                    <td>{percentText(r.ratio)}</td>
                    <td>{STATUS[r.status].label}</td>
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
