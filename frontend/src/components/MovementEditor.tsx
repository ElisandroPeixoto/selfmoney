import { useState, type FormEvent } from "react";

import { updateMovement, type Account, type Movement, type MovementUpdate } from "../api/client";
import { MOVEMENT_KIND_LABELS } from "../lib/options";
import MoneyInput from "./MoneyInput";

const MIN_REASON = 3;

interface Props {
  movement: Movement;
  accounts: Account[];
  onSaved: (movement: Movement) => void;
  onCancel: () => void;
}

interface AccountSelectProps {
  id: string;
  label: string;
  value: number | null;
  /** Name kept in the log when the account was deleted. */
  deletedName: string | null;
  options: Account[];
  onChange: (id: number) => void;
}

function AccountSelect({ id, label, value, deletedName, options, onChange }: AccountSelectProps) {
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <select id={id} value={value ?? ""} onChange={(e) => onChange(Number(e.target.value))}>
        {value === null && (
          <option value="" disabled>
            {deletedName ?? "—"} (excluída)
          </option>
        )}
        {options.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Edits amount, justification and accounts of a recorded movement; its kind stays. */
export default function MovementEditor({ movement, accounts, onSaved, onCancel }: Props) {
  const [fromId, setFromId] = useState(movement.from_account_id);
  const [toId, setToId] = useState(movement.to_account_id);
  const [amount, setAmount] = useState(movement.amount);
  const [reason, setReason] = useState(movement.reason);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { kind } = movement;
  const isTransfer = kind === "transfer";
  const from = accounts.find((a) => a.id === fromId);
  // Transfers only between different accounts of the same currency.
  const currency = from?.currency ?? movement.currency;
  const destinations = isTransfer
    ? accounts.filter((a) => a.id !== fromId && a.currency === currency)
    : accounts;
  const effectiveToId =
    toId === null || destinations.some((a) => a.id === toId) ? toId : (destinations[0]?.id ?? null);
  const to = accounts.find((a) => a.id === effectiveToId);

  const changes: MovementUpdate = {};
  if (Number(amount) !== Number(movement.amount)) changes.amount = amount;
  if (reason.trim() !== movement.reason) changes.reason = reason.trim();
  if (kind !== "deposit" && fromId !== null && fromId !== movement.from_account_id) {
    changes.from_account_id = fromId;
  }
  if (kind !== "withdrawal" && effectiveToId !== null && effectiveToId !== movement.to_account_id) {
    changes.to_account_id = effectiveToId;
  }
  const reasonOk = reason.trim().length >= MIN_REASON;
  const valid = Number(amount) > 0 && reasonOk && (!isTransfer || effectiveToId !== null);
  const canSave = valid && Object.keys(changes).length > 0 && !saving;
  const label = MOVEMENT_KIND_LABELS[kind];

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      onSaved(await updateMovement(movement.id, changes));
    } catch {
      setError("Não foi possível salvar a movimentação.");
      setSaving(false);
    }
  }

  return (
    <form
      className="movement-editor"
      onSubmit={handleSubmit}
      aria-label={`Editar ${label.toLowerCase()}`}
    >
      <h3 className="movement-editor-title">Editar {label.toLowerCase()}</h3>
      <div className="form-grid">
        {kind !== "deposit" && (
          <AccountSelect
            id="edit-movement-from"
            label={isTransfer ? "De" : "Conta"}
            value={fromId}
            deletedName={movement.from_account_name}
            options={accounts}
            onChange={setFromId}
          />
        )}
        {kind !== "withdrawal" && (
          <AccountSelect
            id="edit-movement-to"
            label={isTransfer ? "Para" : "Conta"}
            value={effectiveToId}
            deletedName={movement.to_account_name}
            options={destinations}
            onChange={setToId}
          />
        )}
        <label className="field" htmlFor="edit-movement-amount">
          <span>Valor</span>
          <MoneyInput
            id="edit-movement-amount"
            value={amount}
            onChange={setAmount}
            currency={(from ?? to)?.currency ?? movement.currency}
            required
          />
        </label>
      </div>

      <label className="field reason-field" htmlFor="edit-movement-reason">
        <span>Justificativa (obrigatória)</span>
        <textarea
          id="edit-movement-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          rows={2}
          required
        />
      </label>

      {isTransfer && destinations.length === 0 && (
        <p className="hint">Não há outra conta em {currency} para receber a transferência.</p>
      )}

      <div className="form-actions">
        {error && (
          <span role="alert" className="error">
            {error}
          </span>
        )}
        {!reasonOk && (
          <span className="hint">A justificativa precisa de pelo menos {MIN_REASON} letras.</span>
        )}
        <button type="button" className="button" onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="button primary" disabled={!canSave}>
          Salvar alterações
        </button>
      </div>
    </form>
  );
}
