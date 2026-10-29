import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TooltipProps } from "recharts";

import {
  exportCardBill,
  fetchCardBills,
  type CardBill,
  type Category,
  type CreditCard,
} from "../api/client";
import { shiftMonth, type YearMonth } from "../lib/cards";
import { formatCurrency, formatCurrencyRounded, formatMonth, monthName } from "../lib/format";
import { UNCATEGORIZED_COLOR } from "../lib/options";
import CategoryLabel from "./CategoryLabel";

const CHART_MONTHS = 12;

interface Props {
  card: CreditCard;
  categories: Category[];
  /** Changes whenever purchases change, so the bills are fetched again. */
  version: number;
  onExported: () => void;
}

interface Row {
  key: string;
  label: string;
  bill: CardBill;
  total: number;
}

function currentMonth(): YearMonth {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function shortLabel(bill: YearMonth): string {
  return `${monthName(bill.month).slice(0, 3)}/${String(bill.year).slice(2)}`;
}

/** Month-by-month bills of a card: the next 12 months in a chart, and one bill in detail. */
export default function CardBills({ card, categories, version, onExported }: Props) {
  const [start] = useState(currentMonth);
  const [selected, setSelected] = useState(currentMonth);
  const [upcoming, setUpcoming] = useState<CardBill[] | null>(null);
  const [bill, setBill] = useState<CardBill | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchCardBills(card.id, start.year, start.month, CHART_MONTHS, controller.signal)
      .then(setUpcoming)
      .catch(() => !controller.signal.aborted && setLoadError(true));
    return () => controller.abort();
  }, [card.id, start, version]);

  useEffect(() => {
    const controller = new AbortController();
    fetchCardBills(card.id, selected.year, selected.month, 1, controller.signal)
      .then(([loaded]) => setBill(loaded))
      .catch(() => !controller.signal.aborted && setLoadError(true));
    return () => controller.abort();
  }, [card.id, selected, version]);

  function move(delta: number) {
    setSelected((prev) => shiftMonth(prev, delta));
    setMessage(null);
  }

  async function handleExport() {
    if (!bill || card.account_id === null) return;
    const pending = bill.installments.filter((i) => i.transaction_id === null).length;
    const ok = window.confirm(
      `Lançar ${pending} parcela(s) da fatura de ${formatMonth(bill.year, bill.month)} ` +
        `em Lançamentos, na conta ${card.account_name}?`,
    );
    if (!ok) return;
    setExporting(true);
    try {
      const result = await exportCardBill(card.id, bill.year, bill.month);
      setBill(result.bill);
      setMessage({
        kind: "ok",
        text: `${result.created} lançamento(s) criado(s) na conta ${card.account_name}.`,
      });
      onExported();
    } catch {
      setMessage({ kind: "error", text: "Não foi possível exportar a fatura." });
    } finally {
      setExporting(false);
    }
  }

  const categoriesById = new Map(categories.map((c) => [c.id, c]));
  const rows: Row[] =
    upcoming?.map((b) => ({
      key: `${b.year}-${b.month}`,
      label: shortLabel(b),
      bill: b,
      total: Number(b.total),
    })) ?? [];
  const hasUpcoming = rows.some((r) => r.total > 0);
  const pending = bill ? Number(bill.pending_total) : 0;

  function BillTooltip({ active, payload }: TooltipProps<number, string>) {
    const row = payload?.[0]?.payload as Row | undefined;
    if (!active || !row) return null;
    return (
      <div className="chart-tooltip chart-tooltip-stack">
        <strong>{formatMonth(row.bill.year, row.bill.month)}</strong>
        <span>Total: {formatCurrency(row.bill.total, card.currency)}</span>
        <span className="muted">
          A lançar: {formatCurrency(row.bill.pending_total, card.currency)}
        </span>
      </div>
    );
  }

  if (loadError) {
    return (
      <p role="alert" className="error">
        Não foi possível carregar as faturas.
      </p>
    );
  }

  return (
    <>
      <section className="card" aria-labelledby="card-upcoming-title">
        <h2 id="card-upcoming-title" className="card-title">
          Próximas faturas
        </h2>
        {upcoming === null && <p className="muted">Carregando…</p>}
        {upcoming && !hasUpcoming && (
          <p className="empty">Nenhuma parcela nos próximos {CHART_MONTHS} meses.</p>
        )}
        {upcoming && hasUpcoming && (
          <>
            <div
              className="card-bills-chart"
              role="img"
              aria-label={`Valor das faturas de ${card.name} nos próximos ${CHART_MONTHS} meses`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={(v: number) => formatCurrencyRounded(v, card.currency)}
                    tick={{ fill: "var(--text-muted)", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                    width={88}
                  />
                  <Tooltip content={<BillTooltip />} cursor={{ fill: "var(--bg)" }} />
                  <Bar
                    dataKey="total"
                    name="Fatura"
                    fill="var(--accent)"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={28}
                    isAnimationActive={false}
                    cursor="pointer"
                    onClick={({ payload }: { payload: Row }) =>
                      setSelected({ year: payload.bill.year, month: payload.bill.month })
                    }
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="visually-hidden">
              <table>
                <caption>Faturas dos próximos {CHART_MONTHS} meses</caption>
                <thead>
                  <tr>
                    <th scope="col">Mês</th>
                    <th scope="col">Total</th>
                    <th scope="col">A lançar</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key}>
                      <td>{formatMonth(r.bill.year, r.bill.month)}</td>
                      <td>{formatCurrency(r.bill.total, card.currency)}</td>
                      <td>{formatCurrency(r.bill.pending_total, card.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="card" aria-labelledby="card-bill-title">
        <div className="card-header">
          <h2 id="card-bill-title" className="card-title">
            Fatura de {formatMonth(selected.year, selected.month)}
          </h2>
          <div className="card-actions">
            <button type="button" className="button" onClick={() => move(-1)}>
              ‹ Mês anterior
            </button>
            <button type="button" className="button" onClick={() => move(1)}>
              Próximo mês ›
            </button>
          </div>
        </div>

        {bill === null && <p className="muted">Carregando…</p>}
        {bill && bill.installments.length === 0 && (
          <p className="empty">Nenhuma parcela nesta fatura.</p>
        )}
        {bill && bill.installments.length > 0 && (
          <>
            <p className="budget-chart-summary" data-testid="card-bill-totals">
              <span className="muted">Total </span>
              <strong>{formatCurrency(bill.total, card.currency)}</strong>
              <span className="muted"> · A lançar </span>
              <strong>{formatCurrency(bill.pending_total, card.currency)}</strong>
            </p>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Compra</th>
                    <th scope="col">Parcela</th>
                    <th scope="col">Categoria</th>
                    <th scope="col">Situação</th>
                    <th scope="col" className="num">
                      Valor
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {bill.installments.map((i) => {
                    const category =
                      i.category_id !== null ? categoriesById.get(i.category_id) : undefined;
                    return (
                      <tr key={`${i.purchase_id}-${i.number}`}>
                        <td>{i.description}</td>
                        <td className="nowrap">
                          {i.number}/{i.installments}
                        </td>
                        <td>
                          <CategoryLabel
                            name={category?.name ?? "Sem categoria"}
                            color={category?.color ?? UNCATEGORIZED_COLOR}
                            icon={category?.icon}
                          />
                        </td>
                        <td className="nowrap">
                          {i.transaction_id !== null ? (
                            <span className="installment-status done">✓ Lançada</span>
                          ) : (
                            <span className="installment-status">○ Pendente</span>
                          )}
                        </td>
                        <td className="value nowrap">{formatCurrency(i.amount, card.currency)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="form-actions">
          {message && (
            <span
              role={message.kind === "error" ? "alert" : "status"}
              className={message.kind === "error" ? "error" : "success"}
            >
              {message.text}
            </span>
          )}
          {card.account_id === null && bill && pending > 0 && (
            <span className="muted">Vincule o cartão a uma conta para exportar.</span>
          )}
          <button
            type="button"
            className="button primary"
            onClick={handleExport}
            disabled={exporting || card.account_id === null || pending === 0}
          >
            Exportar para Lançamentos
          </button>
        </div>
      </section>
    </>
  );
}
