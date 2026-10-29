import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, type TooltipProps } from "recharts";

import type { CategorySpending, Currency } from "../api/client";
import { formatCurrency, formatMonth, formatPercent, monthName } from "../lib/format";
import CategoryLabel from "./CategoryLabel";

interface Props {
  data: CategorySpending[];
  total: string;
  currency: Currency;
  availableCurrencies: Currency[];
  onCurrencyChange: (currency: Currency) => void;
  year: number;
  month: number;
  years: number[];
  onPeriodChange: (year: number, month: number) => void;
}

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

interface Slice {
  name: string;
  color: string;
  value: number;
  share: number;
  currency: Currency;
  icon: string | null;
}

function SliceTooltip({ active, payload }: TooltipProps<number, string>) {
  const slice = payload?.[0]?.payload as Slice | undefined;
  if (!active || !slice) return null;
  return (
    <div className="chart-tooltip">
      <span className="swatch" style={{ background: slice.color }} />
      <strong>
        {slice.icon && `${slice.icon} `}
        {slice.name}
      </strong>
      <span>{formatCurrency(slice.value, slice.currency)}</span>
      <span className="muted">{formatPercent(slice.share)}</span>
    </div>
  );
}

export default function SpendingChart({
  data,
  total,
  currency,
  availableCurrencies,
  onCurrencyChange,
  year,
  month,
  years,
  onPeriodChange,
}: Props) {
  const totalNumber = Number(total);
  const slices: Slice[] = data.map((item) => ({
    name: item.name,
    color: item.color,
    value: Number(item.total),
    share: totalNumber > 0 ? Number(item.total) / totalNumber : 0,
    currency,
    icon: item.icon,
  }));

  return (
    <section className="card" aria-labelledby="spending-title">
      <div className="card-header">
        <h2 id="spending-title" className="card-title">
          Gastos do mês por categoria
        </h2>
        <div className="card-actions">
          <select
            className="compact-select"
            aria-label="Mês do gráfico de gastos"
            value={month}
            onChange={(e) => onPeriodChange(year, Number(e.target.value))}
          >
            {MONTHS.map((m) => (
              <option key={m} value={m}>
                {monthName(m)}
              </option>
            ))}
          </select>
          <select
            className="compact-select"
            aria-label="Ano do gráfico de gastos"
            value={year}
            onChange={(e) => onPeriodChange(Number(e.target.value), month)}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          {/* Amounts in different currencies can't share one chart; pick which to show. */}
          {availableCurrencies.length > 1 && (
            <select
              className="compact-select"
              aria-label="Moeda do gráfico"
              value={currency}
              onChange={(e) => onCurrencyChange(e.target.value as Currency)}
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

      {slices.length === 0 ? (
        <p className="empty">Nenhum gasto registrado em {formatMonth(year, month)}.</p>
      ) : (
        <div className="spending-body">
          <div
            className="donut"
            role="img"
            aria-label={`Gráfico de gastos por categoria em ${formatMonth(year, month)}`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={slices}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="62%"
                  outerRadius="100%"
                  stroke="var(--surface)"
                  strokeWidth={2}
                  isAnimationActive={false}
                >
                  {slices.map((slice) => (
                    <Cell key={slice.name} fill={slice.color} />
                  ))}
                </Pie>
                <Tooltip content={<SliceTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="donut-center">
              <span className="muted">Total</span>
              <strong>{formatCurrency(total, currency)}</strong>
            </div>
          </div>

          {/* Legend doubles as the accessible table view of the chart. */}
          <table className="legend-table">
            <thead>
              <tr>
                <th scope="col">Categoria</th>
                <th scope="col">Valor</th>
                <th scope="col">%</th>
              </tr>
            </thead>
            <tbody>
              {slices.map((slice) => (
                <tr key={slice.name}>
                  <td>
                    <CategoryLabel name={slice.name} color={slice.color} icon={slice.icon} />
                  </td>
                  <td className="value">{formatCurrency(slice.value, currency)}</td>
                  <td className="muted">{formatPercent(slice.share)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
