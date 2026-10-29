import type { Budget, Currency } from "../api/client";

/** The budget an expense can count against: same month and same currency (one per month). */
export function budgetFor(
  budgets: Budget[],
  year: number,
  month: number,
  currency: Currency | undefined,
): Budget | undefined {
  return budgets.find(
    (b) => b.year === year && b.month === month && b.currency === currency,
  );
}
