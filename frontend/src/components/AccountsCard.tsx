import type { Account, DashboardSummary } from "../api/client";
import { formatCurrency } from "../lib/format";
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
    <section className="card" aria-labelledby="accounts-title">
      <h2 id="accounts-title" className="card-title">
        Saldo das contas
      </h2>
      <div data-testid="total-balance">
        {totals.map((item) => (
          <p key={item.currency} className="hero-number">
            {formatCurrency(item.total, item.currency)}
          </p>
        ))}
      </div>
      <p className="muted">{totals.length > 1 ? "Saldo total por moeda" : "Saldo total"}</p>

      {accounts.length === 0 ? (
        <p className="empty">Nenhuma conta cadastrada.</p>
      ) : (
        <ul className="account-list">
          {accounts.map((account) => (
            <li key={account.id} className="account-row">
              <span className="account-name">
                <BankLogo bank={account.bank} fallbackLabel={account.name} size={28} />
                {account.name}
              </span>
              <span className={Number(account.balance) < 0 ? "value negative" : "value"}>
                {formatCurrency(account.balance, account.currency)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
