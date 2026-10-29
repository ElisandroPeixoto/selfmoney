import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import {
  fetchBudgets,
  fetchDashboardSummary,
  type Budget,
  type Currency,
  type DashboardSummary,
} from "../api/client";
import AccountsCard from "../components/AccountsCard";
import BudgetChart from "../components/BudgetChart";
import IncomeExpenseChart from "../components/IncomeExpenseChart";
import SpendingChart from "../components/SpendingChart";
import { formatMonth } from "../lib/format";

// The yearly charts can look back a few years (and at next year's planned entries).
function yearOptions(current: number): number[] {
  return Array.from({ length: 7 }, (_, i) => current + 1 - i);
}

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; summary: DashboardSummary };

export default function Dashboard() {
  const [state, setState] = useState<State>({ status: "loading" });
  const today = new Date();
  const [currency, setCurrency] = useState<Currency>("BRL");
  const [period, setPeriod] = useState({ year: today.getFullYear(), month: today.getMonth() + 1 });
  const [budgets, setBudgets] = useState<Budget[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchBudgets(controller.signal)
      .then(setBudgets)
      // The budget chart is secondary: without it the rest of the dashboard still works.
      .catch(() => !controller.signal.aborted && setBudgets([]));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // While a new period loads, the previous data stays on screen instead of a spinner.
    fetchDashboardSummary(period.year, period.month, currency, controller.signal)
      .then((summary) => setState({ status: "ready", summary }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.error(error);
          setState({ status: "error" });
        }
      });
    return () => controller.abort();
  }, [currency, period]);

  return (
    <div className="page">
      <header className="page-header page-header-row">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">{formatMonth(today.getFullYear(), today.getMonth() + 1)}</p>
        </div>
        <Link to="/lancamentos?nova=1" className="button primary">
          + Novo lançamento
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
            year={period.year}
            month={period.month}
            years={yearOptions(today.getFullYear())}
            onPeriodChange={(year, month) => setPeriod({ year, month })}
          />
          <IncomeExpenseChart
            years={yearOptions(today.getFullYear())}
            availableCurrencies={state.summary.balances_by_currency.map((b) => b.currency)}
          />
          {budgets && <BudgetChart budgets={budgets} />}
        </div>
      )}
    </div>
  );
}
