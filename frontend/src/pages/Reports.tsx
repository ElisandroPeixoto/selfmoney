import { useEffect, useState, type FormEvent } from "react";

import {
  downloadMonthlyReport,
  fetchAccounts,
  type Currency,
} from "../api/client";
import { saveFile } from "../lib/download";
import { formatMonth, monthName } from "../lib/format";

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

const CONTENTS = [
  "Receitas, despesas, saldo do mês e taxa de economia, comparados ao mês anterior",
  "Destaques do mês em poucas frases",
  "Gráfico de receitas vs despesas dos últimos 6 meses",
  "Despesas por categoria, com gráfico de rosca",
  "Orçamento do mês: uso por categoria, com o limite e a situação de cada uma",
  "Receitas por categoria e as maiores despesas",
  "Saldo de cada conta no momento em que o relatório é gerado",
  "Movimentações e lista de lançamentos do mês",
];

function yearOptions(current: number): number[] {
  return Array.from({ length: 7 }, (_, i) => current - i);
}

type Status =
  | { state: "idle" }
  | { state: "generating" }
  | { state: "done"; filename: string; period: string }
  | { state: "error" };

export default function Reports() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [currency, setCurrency] = useState<Currency>("BRL");
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [status, setStatus] = useState<Status>({ state: "idle" });

  useEffect(() => {
    const controller = new AbortController();
    fetchAccounts(controller.signal)
      .then((accounts) => {
        const codes = [...new Set(accounts.map((a) => a.currency))].sort();
        setCurrencies(codes);
        if (codes.length > 0 && !codes.includes("BRL")) setCurrency(codes[0]);
      })
      // Without accounts the report still works in BRL; the currency picker just stays hidden.
      .catch(() => {});
    return () => controller.abort();
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus({ state: "generating" });
    try {
      const { blob, filename } = await downloadMonthlyReport(
        year,
        month,
        currency,
      );
      saveFile(blob, filename);
      setStatus({ state: "done", filename, period: formatMonth(year, month) });
    } catch (error) {
      console.error(error);
      setStatus({ state: "error" });
    }
  }

  const generating = status.state === "generating";

  return (
    <div className="page">
      <header className="page-header">
        <h1>Relatórios</h1>
        <p className="muted">
          Gere um resumo do mês em PDF para guardar, imprimir ou compartilhar.
        </p>
      </header>

      <section className="card" aria-labelledby="monthly-report-title">
        <h2 id="monthly-report-title" className="card-title">
          Relatório mensal em PDF
        </h2>
        <form
          className="report-form"
          aria-label="Gerar relatório mensal"
          onSubmit={handleSubmit}
        >
          <div className="filters">
            <label className="field" htmlFor="report-month">
              <span>Mês</span>
              <select
                id="report-month"
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
            <label className="field" htmlFor="report-year">
              <span>Ano</span>
              <select
                id="report-year"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
              >
                {yearOptions(today.getFullYear()).map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            {/* Amounts in different currencies are never added up: one report per currency. */}
            {currencies.length > 1 && (
              <label className="field" htmlFor="report-currency">
                <span>Moeda</span>
                <select
                  id="report-currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as Currency)}
                >
                  {currencies.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="submit"
              className="button primary report-submit"
              disabled={generating}
            >
              {generating ? "Gerando…" : "Gerar PDF"}
            </button>
          </div>
        </form>

        {status.state === "done" && (
          <p className="notice" role="status">
            Relatório de {status.period} gerado: {status.filename}
          </p>
        )}
        {status.state === "error" && (
          <p className="error" role="alert">
            Não foi possível gerar o relatório. Verifique se a API está rodando.
          </p>
        )}

        <h3 className="report-contents-title">O que o relatório traz</h3>
        <ul className="report-contents">
          {CONTENTS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
