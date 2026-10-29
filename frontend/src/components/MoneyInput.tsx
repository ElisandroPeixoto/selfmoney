import { useState, type ChangeEvent } from "react";

import { currencySymbol } from "../lib/format";

// Values up to 999.999.999.999,99 (the API stores 14 digits with 2 decimals).
const MAX_DIGITS = 14;

const display = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Decimal string from the API/form state ("1234.5") → integer cents, or null when empty. */
function toCents(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** Integer cents → decimal string with exactly two places, built without float math. */
function fromCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

interface Props {
  id?: string;
  /** Decimal string ("1234.56"), or "" when empty. */
  value: string;
  onChange: (value: string) => void;
  currency?: string;
  allowNegative?: boolean;
  required?: boolean;
  "aria-label"?: string;
}

/**
 * Money field with the currency symbol in front and cents always shown.
 *
 * Typing fills from the right, like a cash register: "1" → 0,01, "12" → 0,12, "1234" → 12,34.
 */
export default function MoneyInput({
  id,
  value,
  onChange,
  currency = "BRL",
  allowNegative = false,
  required,
  "aria-label": ariaLabel,
}: Props) {
  // A lone "-" has no digits yet, so it can't live in `value`; remember it until they arrive.
  const [pendingMinus, setPendingMinus] = useState(false);
  const cents = toCents(value);
  const negative = allowNegative && (pendingMinus || (cents !== null && cents < 0));
  const text =
    cents === null
      ? negative
        ? "-"
        : ""
      : (cents < 0 ? "-" : "") + display.format(Math.abs(cents) / 100);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const raw = event.target.value;
    const digits = raw.replace(/\D/g, "").replace(/^0+/, "").slice(0, MAX_DIGITS);
    const wantsNegative = allowNegative && raw.includes("-");
    if (digits === "") {
      setPendingMinus(wantsNegative);
      onChange("");
      return;
    }
    setPendingMinus(false);
    const amount = Number(digits);
    onChange(fromCents(wantsNegative ? -amount : amount));
  }

  return (
    <div className="money-input">
      {/* Drawn with CSS so the symbol isn't read as part of the surrounding label's text. */}
      <span className="money-prefix" data-symbol={currencySymbol(currency)} aria-hidden="true" />
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={text}
        onChange={handleChange}
        placeholder="0,00"
        required={required}
        aria-label={ariaLabel}
      />
    </div>
  );
}
