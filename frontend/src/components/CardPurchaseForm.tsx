import { useState, type FormEvent } from "react";

import {
  createCardPurchase,
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
  onCreated: (purchase: CardPurchase) => void;
}

function today(): string {
  const now = new Date();
  return toIsoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

const MAX_INSTALLMENTS = 48;

export default function CardPurchaseForm({ card, categories, onCreated }: Props) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [installments, setInstallments] = useState("1");
  const [date, setDate] = useState(today);
  // Follows the purchase date until the user picks a bill.
  const [firstBill, setFirstBill] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    try {
      const created = await createCardPurchase(card.id, {
        description: description.trim(),
        amount,
        installments: count,
        date,
        first_year: bill.year,
        first_month: bill.month,
        category_id: categoryId,
      });
      onCreated(created);
      setDescription("");
      setAmount("");
      setInstallments("1");
      setFirstBill(null);
    } catch {
      setError("Não foi possível adicionar a compra.");
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
    <form onSubmit={handleSubmit} aria-label="Nova compra">
      <div className="form-grid">
        <label className="field" htmlFor="purchase-description">
          <span>Descrição</span>
          <input
            id="purchase-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={150}
            placeholder="Ex.: Geladeira"
            required
          />
        </label>
        <label className="field" htmlFor="purchase-amount">
          <span>Valor total</span>
          <MoneyInput
            id="purchase-amount"
            value={amount}
            onChange={setAmount}
            currency={card.currency}
          />
        </label>
        <label className="field" htmlFor="purchase-installments">
          <span>Parcelas</span>
          <input
            id="purchase-installments"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_INSTALLMENTS}
            value={installments}
            onChange={(e) => setInstallments(e.target.value)}
            required
          />
        </label>
        <label className="field" htmlFor="purchase-date">
          <span>Data da compra</span>
          <input
            id="purchase-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </label>
        <label className="field" htmlFor="purchase-first-bill">
          <span>1ª parcela na fatura de</span>
          <input
            id="purchase-first-bill"
            type="month"
            value={firstBillValue}
            onChange={(e) => setFirstBill(e.target.value)}
            required
          />
        </label>
        <label className="field" htmlFor="purchase-category">
          <span>Categoria</span>
          <select
            id="purchase-category"
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

      {card.auto_export && card.account_name && (
        <p className="hint">
          Exportação automática ligada: as parcelas vão direto para Lançamentos, na conta{" "}
          {card.account_name}.
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
        <button type="submit" className="button primary" disabled={saving || !canSave}>
          Adicionar compra
        </button>
      </div>
    </form>
  );
}
