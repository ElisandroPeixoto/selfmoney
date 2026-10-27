import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { fetchDashboardSummary, type Currency, type DashboardSummary } from "../api/client";
import AccountsCard from "../components/AccountsCard";
import SpendingChart from "../components/SpendingChart";
import { formatMonth } from "../lib/format";

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; summary: DashboardSummary };

export default function Dashboard() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [currency, setCurrency] = useState<Currency>("BRL");

  useEffect(() => {
    const now = new Date();
    const controller = new AbortController();
    fetchDashboardSummary(now.getFullYear(), now.getMonth() + 1, currency, controller.signal)
      .then((summary) => setState({ status: "ready", summary }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.error(error);
          setState({ status: "error" });
        }
      });
    return () => controller.abort();
  }, [currency]);

  return (
    <div className="page">
      <header className="page-header page-header-row">
        <div>
          <h1>Dashboard</h1>
          {state.status === "ready" && (
            <p className="muted">{formatMonth(state.summary.year, state.summary.month)}</p>
          )}
        </div>
        <Link to="/lancamentos?nova=1" className="button primary">
          + Nova despesa
        </Link>
      </header>

      {state.status === "loading" && <p className="muted">Carregando…</p>}
      {state.status === "error" && (
        <p role="alert" className="error">
          Não foi possível carregar os dados. Verifique se a API está rodando.
        </p>
      )}
      {state.status === "ready" && (
        <div className="grid">
          <AccountsCard
            accounts={state.summary.accounts}
            balancesByCurrency={state.summary.balances_by_currency}
          />
          <SpendingChart
            data={state.summary.spending_by_category}
            total={state.summary.month_expenses}
            currency={state.summary.currency}
            availableCurrencies={state.summary.balances_by_currency.map((b) => b.currency)}
            onCurrencyChange={setCurrency}
          />
        </div>
      )}
    </div>
  );
}
