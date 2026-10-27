import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import {
  depositMoney,
  transferMoney,
  withdrawMoney,
  type Account,
  type Movement,
  type MovementKind,
} from "../api/client";
import { formatCurrency } from "../lib/format";

const TABS: { kind: MovementKind; label: string; submit: string }[] = [
  { kind: "transfer", label: "Transferir", submit: "Transferir" },
  { kind: "deposit", label: "Adicionar dinheiro", submit: "Adicionar" },
  { kind: "withdrawal", label: "Retirar dinheiro", submit: "Retirar" },
];

const MIN_REASON = 3;

interface Props {
  accounts: Account[];
  kind: MovementKind;
  onKindChange: (kind: MovementKind) => void;
  onRecorded: (movement: Movement) => void;
}

function accountOption(account: Account): string {
  return `${account.name} — ${formatCurrency(account.balance, account.currency)}`;
}

function BalancePreview({ account, delta }: { account: Account; delta: number }) {
  const after = Number(account.balance) + delta;
  return (
    <p className="balance-preview">
      {account.name}: {formatCurrency(account.balance, account.currency)} →{" "}
      <strong className={after < 0 ? "negative" : undefined}>
        {formatCurrency(after, account.currency)}
      </strong>
      {after < 0 && <span className="negative"> (saldo ficará negativo)</span>}
    </p>
  );
}

export default function MovementForm({ accounts, kind, onKindChange, onRecorded }: Props) {
  const [fromId, setFromId] = useState<number | null>(accounts[0]?.id ?? null);
  const [toId, setToId] = useState<number | null>(accounts[1]?.id ?? accounts[0]?.id ?? null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tab = TABS.find((t) => t.kind === kind)!;
  const from = accounts.find((a) => a.id === fromId);
  const to = accounts.find((a) => a.id === toId);
  const amountNum = Number(amount);
  // Transfers only between accounts of the same currency.
  const destinations = accounts.filter(
    (a) => a.id !== fromId && (!from || a.currency === from.currency),
  );
  const effectiveTo =
    kind === "transfer" ? destinations.find((a) => a.id === toId) ?? destinations[0] : to;
  const needsFrom = kind !== "deposit";
  const needsTo = kind !== "withdrawal";
  const reasonOk = reason.trim().length >= MIN_REASON;
  const canSubmit =
    amountNum > 0 &&
    reasonOk &&
    (!needsFrom || from) &&
    (!needsTo || effectiveTo) &&
    !saving;

  if (accounts.length === 0) {
    return (
      <section className="card">
        <p className="empty">
          Cadastre uma conta para movimentar dinheiro. <Link to="/contas">Ir para Contas</Link>
        </p>
      </section>
    );
  }

  function describe(): string {
    const value = formatCurrency(amountNum, (from ?? effectiveTo)!.currency);
    if (kind === "transfer") {
      return `Transferir ${value} de ${from!.name} para ${effectiveTo!.name}?`;
    }
    if (kind === "deposit") return `Adicionar ${value} em ${effectiveTo!.name}?`;
    return `Retirar ${value} de ${from!.name}?`;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    // Movements are permanent log entries, so confirm before recording.
    if (!window.confirm(`${describe()}\n\nJustificativa: ${reason.trim()}`)) return;
    setSaving(true);
    setError(null);
    try {
      const base = { amount, reason: reason.trim() };
      const movement =
        kind === "transfer"
          ? await transferMoney({
              ...base,
              from_account_id: from!.id,
              to_account_id: effectiveTo!.id,
            })
          : kind === "deposit"
            ? await depositMoney({ ...base, account_id: effectiveTo!.id })
            : await withdrawMoney({ ...base, account_id: from!.id });
      onRecorded(movement);
      setAmount("");
      setReason("");
    } catch {
      setError("Não foi possível registrar a movimentação.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card" aria-labelledby="movement-form-title">
      <h2 id="movement-form-title" className="visually-hidden">
        Nova movimentação
      </h2>
      <div className="segmented" role="tablist" aria-label="Tipo de movimentação">
        {TABS.map((t) => (
          <button
            key={t.kind}
            type="button"
            role="tab"
            aria-selected={kind === t.kind}
            className={kind === t.kind ? "segment active" : "segment"}
            onClick={() => {
              onKindChange(t.kind);
              setError(null);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} aria-label={tab.label}>
        <div className="form-grid">
          {needsFrom && (
            <label className="field" htmlFor="movement-from">
              <span>{kind === "transfer" ? "De" : "Conta"}</span>
              <select
                id="movement-from"
                value={fromId ?? ""}
                onChange={(e) => setFromId(Number(e.target.value))}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {accountOption(a)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {needsTo && (
            <label className="field" htmlFor="movement-to">
              <span>{kind === "transfer" ? "Para" : "Conta"}</span>
              <select
                id="movement-to"
                value={effectiveTo?.id ?? ""}
                onChange={(e) => setToId(Number(e.target.value))}
                disabled={kind === "transfer" && destinations.length === 0}
              >
                {(kind === "transfer" ? destinations : accounts).map((a) => (
                  <option key={a.id} value={a.id}>
                    {accountOption(a)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field" htmlFor="movement-amount">
            <span>Valor</span>
            <input
              id="movement-amount"
              type="number"
              min="0.01"
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0,00"
              required
            />
          </label>
        </div>

        <label className="field reason-field" htmlFor="movement-reason">
          <span>Justificativa (obrigatória)</span>
          <textarea
            id="movement-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder={
              kind === "transfer"
                ? "Ex.: Guardar dinheiro na reserva de emergência"
                : kind === "deposit"
                  ? "Ex.: Reembolso de um amigo"
                  : "Ex.: Saque para pagar em dinheiro"
            }
            required
          />
        </label>

        {kind === "transfer" && from && destinations.length === 0 && (
          <p className="hint">
            Não há outra conta em {from.currency} para receber a transferência.
          </p>
        )}
        {amountNum > 0 && (
          <div className="balance-previews">
            {needsFrom && from && <BalancePreview account={from} delta={-amountNum} />}
            {needsTo && effectiveTo && <BalancePreview account={effectiveTo} delta={amountNum} />}
          </div>
        )}

        <div className="form-actions">
          {error && (
            <span role="alert" className="error">
              {error}
            </span>
          )}
          {!reasonOk && reason.length > 0 && (
            <span className="hint">A justificativa precisa de pelo menos {MIN_REASON} letras.</span>
          )}
          <button type="submit" className="button primary" disabled={!canSubmit}>
            {tab.submit}
          </button>
        </div>
      </form>
    </section>
  );
}
