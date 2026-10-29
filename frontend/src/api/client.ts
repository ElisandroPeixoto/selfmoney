import type { components } from "./schema";

type Schemas = components["schemas"];

export type DashboardSummary = Schemas["DashboardSummary"];
export type Account = Schemas["AccountRead"];
export type AccountCreate = Schemas["AccountCreate"];
export type AccountUpdate = Schemas["AccountUpdate"];
export type Category = Schemas["CategoryRead"];
export type CategoryCreate = Schemas["CategoryCreate"];
export type CategoryUpdate = Schemas["CategoryUpdate"];
export type Transaction = Schemas["TransactionRead"];
export type TransactionCreate = Schemas["TransactionCreate"];
export type TransactionUpdate = Schemas["TransactionUpdate"];
export type TransactionType = Schemas["TransactionType"];
export type MonthTotals = Schemas["MonthTotals"];
export type Budget = Schemas["BudgetRead"];
export type BudgetCreate = Schemas["BudgetCreate"];
export type BudgetItem = Schemas["BudgetItemRead"];
export type BudgetItemCreate = Schemas["BudgetItemCreate"];
export type BudgetItemUpdate = Schemas["BudgetItemUpdate"];
export type BudgetTemplate = Schemas["BudgetTemplateRead"];
export type Movement = Schemas["MovementRead"];
export type MovementKind = Schemas["MovementKind"];
export type CategorySpending = Schemas["CategorySpending"];
export type Currency = Schemas["Currency"];
export type Bank = Schemas["Bank"];

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    throw new ApiError(response.status, `Request failed: ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function fetchDashboardSummary(
  year: number,
  month: number,
  currency: Currency,
  signal?: AbortSignal,
): Promise<DashboardSummary> {
  const params = new URLSearchParams({
    year: String(year),
    month: String(month),
    currency,
  });
  return request<DashboardSummary>(`/dashboard/summary?${params}`, { signal });
}

export function fetchAccounts(signal?: AbortSignal): Promise<Account[]> {
  return request<Account[]>("/accounts", { signal });
}

export function createAccount(payload: AccountCreate): Promise<Account> {
  return request<Account>("/accounts", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteAccount(id: number): Promise<void> {
  return request<void>(`/accounts/${id}`, { method: "DELETE" });
}

export function updateAccount(
  id: number,
  changes: AccountUpdate,
): Promise<Account> {
  return request<Account>(`/accounts/${id}`, {
    method: "PATCH",
    body: JSON.stringify(changes),
  });
}

export function fetchCategories(signal?: AbortSignal): Promise<Category[]> {
  return request<Category[]>("/categories", { signal });
}

export function createCategory(payload: CategoryCreate): Promise<Category> {
  return request<Category>("/categories", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteCategory(id: number): Promise<void> {
  return request<void>(`/categories/${id}`, { method: "DELETE" });
}

export function updateCategory(
  id: number,
  changes: CategoryUpdate,
): Promise<Category> {
  return request<Category>(`/categories/${id}`, {
    method: "PATCH",
    body: JSON.stringify(changes),
  });
}

export interface PeriodFilter {
  year: number;
  /** Omit for the whole year. */
  month?: number;
  currency?: Currency;
}

export function fetchTransactions(
  filter: PeriodFilter,
  signal?: AbortSignal,
): Promise<Transaction[]> {
  const params = new URLSearchParams({
    year: String(filter.year),
    limit: "1000",
  });
  if (filter.month) params.set("month", String(filter.month));
  if (filter.currency) params.set("currency", filter.currency);
  return request<Transaction[]>(`/transactions?${params}`, { signal });
}

export function createTransaction(
  payload: TransactionCreate,
): Promise<Transaction> {
  return request<Transaction>("/transactions", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateTransaction(
  id: number,
  changes: TransactionUpdate,
): Promise<Transaction> {
  return request<Transaction>(`/transactions/${id}`, {
    method: "PATCH",
    body: JSON.stringify(changes),
  });
}

export function deleteTransaction(id: number): Promise<void> {
  return request<void>(`/transactions/${id}`, { method: "DELETE" });
}

export function fetchMonthlyTotals(
  year: number,
  currency: Currency,
  signal?: AbortSignal,
): Promise<MonthTotals[]> {
  const params = new URLSearchParams({ year: String(year), currency });
  return request<MonthTotals[]>(`/reports/monthly?${params}`, { signal });
}

export interface ReportFile {
  blob: Blob;
  filename: string;
}

/** Monthly report PDF; the reader's UTC offset sets the times and the month's bounds. */
export async function downloadMonthlyReport(
  year: number,
  month: number,
  currency: Currency,
): Promise<ReportFile> {
  const params = new URLSearchParams({
    year: String(year),
    month: String(month),
    currency,
    utc_offset: String(-new Date().getTimezoneOffset()),
  });
  const response = await fetch(`${BASE_URL}/reports/monthly-pdf?${params}`);
  if (!response.ok) {
    throw new ApiError(response.status, `Request failed: ${response.status}`);
  }
  const fallback = `selfmoney-relatorio-${year}-${String(month).padStart(2, "0")}.pdf`;
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallback;
  return { blob: await response.blob(), filename };
}

export function fetchBudgets(signal?: AbortSignal): Promise<Budget[]> {
  return request<Budget[]>("/budgets", { signal });
}

export function fetchBudget(id: number, signal?: AbortSignal): Promise<Budget> {
  return request<Budget>(`/budgets/${id}`, { signal });
}

export function createBudget(payload: BudgetCreate): Promise<Budget> {
  return request<Budget>("/budgets", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteBudget(id: number): Promise<void> {
  return request<void>(`/budgets/${id}`, { method: "DELETE" });
}

export function addBudgetItem(
  budgetId: number,
  payload: BudgetItemCreate,
): Promise<Budget> {
  return request<Budget>(`/budgets/${budgetId}/items`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateBudgetItem(
  budgetId: number,
  itemId: number,
  changes: BudgetItemUpdate,
): Promise<Budget> {
  return request<Budget>(`/budgets/${budgetId}/items/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify(changes),
  });
}

export function deleteBudgetItem(
  budgetId: number,
  itemId: number,
): Promise<Budget> {
  return request<Budget>(`/budgets/${budgetId}/items/${itemId}`, {
    method: "DELETE",
  });
}

export function fetchBudgetTemplates(
  signal?: AbortSignal,
): Promise<BudgetTemplate[]> {
  return request<BudgetTemplate[]>("/budget-templates", { signal });
}

export function saveBudgetAsTemplate(
  budgetId: number,
  name: string,
): Promise<BudgetTemplate> {
  return request<BudgetTemplate>(`/budgets/${budgetId}/save-template`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function deleteBudgetTemplate(id: number): Promise<void> {
  return request<void>(`/budget-templates/${id}`, { method: "DELETE" });
}

export interface MovementFilter {
  accountId?: number;
  kind?: MovementKind;
  /** Local calendar days, "YYYY-MM-DD", both inclusive. */
  from?: string;
  to?: string;
}

/** Start of a local calendar day as an ISO instant with its UTC offset. */
function localDayStart(iso: string, addDays = 0): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day + addDays).toISOString();
}

export function fetchMovements(
  filter: MovementFilter,
  signal?: AbortSignal,
): Promise<Movement[]> {
  const params = new URLSearchParams();
  if (filter.accountId) params.set("account_id", String(filter.accountId));
  if (filter.kind) params.set("kind", filter.kind);
  // The API compares instants, so send where the user's days begin and end.
  if (filter.from) params.set("created_from", localDayStart(filter.from));
  if (filter.to) params.set("created_before", localDayStart(filter.to, 1));
  return request<Movement[]>(`/movements?${params}`, { signal });
}

export function depositMoney(
  payload: Schemas["DepositCreate"],
): Promise<Movement> {
  return request<Movement>("/movements/deposit", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function withdrawMoney(
  payload: Schemas["WithdrawalCreate"],
): Promise<Movement> {
  return request<Movement>("/movements/withdrawal", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function transferMoney(
  payload: Schemas["TransferCreate"],
): Promise<Movement> {
  return request<Movement>("/movements/transfer", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
