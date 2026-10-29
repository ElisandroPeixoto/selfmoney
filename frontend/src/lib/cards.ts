export interface YearMonth {
  year: number;
  month: number;
}

export function shiftMonth({ year, month }: YearMonth, delta: number): YearMonth {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** "YYYY-MM", the value of an <input type="month">. */
export function toMonthValue({ year, month }: YearMonth): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function fromMonthValue(value: string): YearMonth | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  return match ? { year: Number(match[1]), month: Number(match[2]) } : null;
}

/** Bill of the first installment when the user doesn't pick one: the month after the purchase. */
export function defaultFirstBill(isoDate: string): YearMonth {
  const [year, month] = isoDate.split("-").map(Number);
  return shiftMonth({ year, month }, 1);
}

/** Same split as the API: equal installments, leftover cents on the first one. */
export function splitInstallments(total: string, count: number): { first: number; rest: number } {
  const cents = Math.round(Number(total) * 100);
  const base = Math.floor(cents / count);
  return { first: (base + (cents % count)) / 100, rest: base / 100 };
}
