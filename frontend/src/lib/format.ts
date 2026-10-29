const currencyFormatters = new Map<string, Intl.NumberFormat>();
const percent = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });

// The API serializes money as decimal strings to avoid float rounding on the wire.
export function formatCurrency(value: string | number, currency = "BRL"): string {
  let formatter = currencyFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency });
    currencyFormatters.set(currency, formatter);
  }
  return formatter.format(Number(value));
}

const roundedCurrencyFormatters = new Map<string, Intl.NumberFormat>();

/** Currency without cents, for compact chart labels (exact values go in tooltips). */
export function formatCurrencyRounded(value: string | number, currency = "BRL"): string {
  let formatter = roundedCurrencyFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    });
    roundedCurrencyFormatters.set(currency, formatter);
  }
  return formatter.format(Number(value));
}

/** "R$", "US$", "€"… as pt-BR writes it. */
export function currencySymbol(currency: string): string {
  const parts = new Intl.NumberFormat("pt-BR", { style: "currency", currency }).formatToParts(0);
  return parts.find((p) => p.type === "currency")?.value ?? currency;
}

export function formatPercent(ratio: number): string {
  return percent.format(ratio);
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function formatMonth(year: number, month: number): string {
  const label = new Date(year, month - 1, 1).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
  return capitalize(label);
}

export function monthName(month: number): string {
  return capitalize(new Date(2000, month - 1, 1).toLocaleDateString("pt-BR", { month: "long" }));
}

// Parses "YYYY-MM-DD" by hand: `new Date(iso)` would read it as UTC and can shift the day.
export function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function toIsoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
