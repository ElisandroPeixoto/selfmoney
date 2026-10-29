import { Link } from "react-router-dom";

import type { Account, DashboardSummary } from "../api/client";
import { formatCurrency } from "../lib/format";
import { BANKS } from "../lib/options";
import BankLogo from "./BankLogo";

interface Props {
  accounts: Account[];
  balancesByCurrency: DashboardSummary["balances_by_currency"];
}

export default function AccountsCard({ accounts, balancesByCurrency }: Props) {
  // With no accounts, still show a zero total in the default currency.
  const totals = balancesByCurrency.length
    ? balancesByCurrency
    : [{ currency: "BRL" as const, total: "0" }];

  return (
    <section className="card span-all" aria-labelledby="accounts-title">
      <div className="accounts-summary">
        <h2 id="accounts-title" className="card-title">
          Saldo das contas
        </h2>
        <div className="accounts-total">
          <div data-testid="total-balance">
            {totals.map((item) => (
              <p key={item.currency} className="hero-number">
                {formatCurrency(item.total, item.currency)}
              </p>
            ))}
          </div>
          <p className="muted">{totals.length > 1 ? "Saldo total por moeda" : "Saldo total"}</p>
        </div>
      </div>

      {accounts.length === 0 ? (
        <p className="empty">
          Nenhuma conta cadastrada. <Link to="/contas">Adicionar uma conta</Link>
        </p>
      ) : (
        <ul className="account-cards" aria-label="Contas">
          {accounts.map((account) => (
            <li key={account.id} className="account-card">
              <div className="account-card-bank">
                <BankLogo bank={account.bank} fallbackLabel={account.name} size={32} />
                <span className="muted">
                  {account.bank ? BANKS[account.bank].name : "Sem banco"}
                </span>
              </div>
              <strong className="account-card-name">{account.name}</strong>
              <span
                className={
                  Number(account.balance) < 0
                    ? "account-card-balance negative"
                    : "account-card-balance"
                }
              >
                {formatCurrency(account.balance, account.currency)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
