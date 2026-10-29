import { useState, type FormEvent } from "react";

import {
  ApiError,
  createCard,
  updateCard,
  type Account,
  type CreditCard,
  type Currency,
} from "../api/client";
import { CURRENCIES } from "../lib/options";

interface Props {
  accounts: Account[];
  /** When given, the form edits this card instead of creating a new one. */
  card?: CreditCard;
  onSaved: (card: CreditCard) => void;
  onCancel?: () => void;
}

/** Name, linked account, due day and export mode of a credit card. */
export default function CardForm({ accounts, card, onSaved, onCancel }: Props) {
  const editing = card !== undefined;
  const [name, setName] = useState(card?.name ?? "");
  const [accountId, setAccountId] = useState<number | null>(
    card ? card.account_id : (accounts[0]?.id ?? null),
  );
  const [currency, setCurrency] = useState<Currency>(card?.currency ?? "BRL");
  const [dueDay, setDueDay] = useState(card?.due_day ? String(card.due_day) : "");
  const [autoExport, setAutoExport] = useState(card?.auto_export ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const account = accounts.find((a) => a.id === accountId);
  const prefix = editing ? `card-${card.id}` : "new-card";

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    const payload = {
      name: trimmed,
      account_id: accountId,
      currency: account?.currency ?? currency,
      due_day: dueDay ? Number(dueDay) : null,
      // Exporting needs an account to put the expenses in.
      auto_export: accountId !== null && autoExport,
    };
    try {
      const saved = editing ? await updateCard(card.id, payload) : await createCard(payload);
      onSaved(saved);
      if (!editing) {
        setName("");
        setDueDay("");
        setAutoExport(false);
      }
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? "Já existe um cartão com esse nome."
          : "Não foi possível salvar o cartão.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label={editing ? `Editar cartão ${card.name}` : "Novo cartão"}
    >
      <div className="form-grid">
        <label className="field" htmlFor={`${prefix}-name`}>
          <span>Nome do cartão</span>
          <input
            id={`${prefix}-name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            placeholder="Ex.: Nubank Roxinho"
            required
          />
        </label>
        <label className="field" htmlFor={`${prefix}-account`}>
          <span>Conta vinculada</span>
          <select
            id={`${prefix}-account`}
            value={accountId ?? ""}
            onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Nenhuma</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.currency})
              </option>
            ))}
          </select>
        </label>
        {/* With an account, the card uses the account's currency. */}
        {account === undefined && (
          <label className="field" htmlFor={`${prefix}-currency`}>
            <span>Moeda</span>
            <select
              id={`${prefix}-currency`}
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency)}
            >
              {(Object.keys(CURRENCIES) as Currency[]).map((code) => (
                <option key={code} value={code}>
                  {CURRENCIES[code]}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field" htmlFor={`${prefix}-due`}>
          <span>Dia do vencimento</span>
          <input
            id={`${prefix}-due`}
            type="number"
            inputMode="numeric"
            min={1}
            max={31}
            value={dueDay}
            onChange={(e) => setDueDay(e.target.value)}
            placeholder="Opcional"
          />
        </label>
      </div>

      <label className="checkbox-field" htmlFor={`${prefix}-auto`}>
        <input
          id={`${prefix}-auto`}
          type="checkbox"
          checked={accountId !== null && autoExport}
          disabled={accountId === null}
          onChange={(e) => setAutoExport(e.target.checked)}
        />
        <span>
          Exportar automaticamente para Lançamentos
          <small className="muted">
            {accountId === null
              ? "Vincule uma conta para exportar as compras."
              : `Cada compra nova já lança todas as parcelas em ${account?.name}, uma por mês.`}
          </small>
        </span>
      </label>

      <div className="form-actions">
        {error && (
          <span role="alert" className="error">
            {error}
          </span>
        )}
        {onCancel && (
          <button type="button" className="button" onClick={onCancel}>
            Cancelar
          </button>
        )}
        <button type="submit" className="button primary" disabled={saving || !trimmed}>
          {editing ? "Salvar cartão" : "Adicionar cartão"}
        </button>
      </div>
    </form>
  );
}
