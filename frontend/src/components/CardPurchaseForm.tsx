import { useState, type FormEvent } from "react";

import {
  createCardPurchase,
  updateCardPurchase,
  type CardPurchase,
  type Category,
  type CreditCard,
} from "../api/client";
import { defaultFirstBill, fromMonthValue, splitInstallments, toMonthValue } from "../lib/cards";
import { formatCurrency, toIsoDate } from "../lib/format";
import MoneyInput from "./MoneyInput";

interface Props {
  card: CreditCard;
  categories: Category[];
  /** When given, the form edits this purchase instead of adding a new one. */
  purchase?: CardPurchase;
  onSaved: (purchase: CardPurchase) => void;
  onCancel?: () => void;
}

function today(): string {
  const now = new Date();
  return toIsoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

const MAX_INSTALLMENTS = 48;

export default function CardPurchaseForm({ card, categories, purchase, onSaved, onCancel }: Props) {
  const editing = purchase !== undefined;
  const [description, setDescription] = useState(purchase?.description ?? "");
  const [amount, setAmount] = useState(purchase?.amount ?? "");
  const [installments, setInstallments] = useState(String(purchase?.installments ?? 1));
  const [date, setDate] = useState(purchase?.date ?? today());
  // Follows the purchase date until the user picks a bill.
  const [firstBill, setFirstBill] = useState<string | null>(
    purchase ? toMonthValue({ year: purchase.first_year, month: purchase.first_month }) : null,
  );
  const [categoryId, setCategoryId] = useState<number | null>(purchase?.category_id ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Exported expenses keep their amount and dates, so those fields stay fixed.
  const locked = editing && purchase.exported_installments > 0;
  const prefix = editing ? `purchase-${purchase.id}` : "purchase";
  const count = Number(installments);
  const validCount = Number.isInteger(count) && count >= 1 && count <= MAX_INSTALLMENTS;
  const firstBillValue = firstBill ?? (date ? toMonthValue(defaultFirstBill(date)) : "");
  const expenseCategories = categories.filter((c) => c.kind === "expense");
  const canSave = description.trim() !== "" && Number(amount) > 0 && validCount && !!date;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const bill = fromMonthValue(firstBillValue);
    if (!canSave || !bill) return;
    setSaving(true);
    setError(null);
    const payload = {
      description: description.trim(),
      amount,
      installments: count,
      date,
      first_year: bill.year,
      first_month: bill.month,
      category_id: categoryId,
    };
    try {
      const saved = editing
        ? await updateCardPurchase(card.id, purchase.id, payload)
        : await createCardPurchase(card.id, payload);
      onSaved(saved);
      if (!editing) {
        setDescription("");
        setAmount("");
        setInstallments("1");
        setFirstBill(null);
      }
    } catch {
      setError(
        editing ? "Não foi possível salvar a compra." : "Não foi possível adicionar a compra.",
      );
    } finally {
      setSaving(false);
    }
  }

  let split: string | null = null;
  if (validCount && Number(amount) > 0) {
    const { first, rest } = splitInstallments(amount, count);
    split =
      count === 1
        ? `À vista: ${formatCurrency(first, card.currency)}`
        : `${count}x de ${formatCurrency(rest, card.currency)}` +
          (first !== rest ? ` (a 1ª de ${formatCurrency(first, card.currency)})` : "");
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label={editing ? `Editar compra ${purchase.description}` : "Nova compra"}
    >
      <div className="form-grid">
        <label className="field" htmlFor={`${prefix}-description`}>
          <span>Descrição</span>
          <input
            id={`${prefix}-description`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={150}
            placeholder="Ex.: Geladeira"
            required
          />
        </label>
        <label className="field" htmlFor={`${prefix}-amount`}>
          <span>Valor total</span>
          <MoneyInput
            id={`${prefix}-amount`}
            value={amount}
            onChange={setAmount}
            currency={card.currency}
            disabled={locked}
          />
        </label>
        <label className="field" htmlFor={`${prefix}-installments`}>
          <span>Parcelas</span>
          <input
            id={`${prefix}-installments`}
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_INSTALLMENTS}
            value={installments}
            onChange={(e) => setInstallments(e.target.value)}
            disabled={locked}
            required
          />
        </label>
        <label className="field" htmlFor={`${prefix}-date`}>
          <span>Data da compra</span>
          <input
            id={`${prefix}-date`}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={locked}
            required
          />
        </label>
        <label className="field" htmlFor={`${prefix}-first-bill`}>
          <span>1ª parcela na fatura de</span>
          <input
            id={`${prefix}-first-bill`}
            type="month"
            value={firstBillValue}
            onChange={(e) => setFirstBill(e.target.value)}
            disabled={locked}
            required
          />
        </label>
        <label className="field" htmlFor={`${prefix}-category`}>
          <span>Categoria</span>
          <select
            id={`${prefix}-category`}
            value={categoryId ?? ""}
            onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Sem categoria</option>
            {expenseCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon ? `${c.icon} ` : ""}
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {locked && (
        <p className="hint">
          Esta compra já tem parcelas em Lançamentos, então valor, parcelas e datas não podem
          mudar. Descrição e categoria valem só para as próximas parcelas lançadas.
        </p>
      )}

      <div className="form-actions">
        {split && (
          <span className="muted grow" data-testid="purchase-split">
            {split}
          </span>
        )}
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
        <button type="submit" className="button primary" disabled={saving || !canSave}>
          {editing ? "Salvar compra" : "Adicionar compra"}
        </button>
      </div>
    </form>
  );
}
