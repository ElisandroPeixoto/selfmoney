import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import type { Account, Category, MonthTotals, Transaction } from "../api/client";
import { mockApi, renderApp } from "../test/utils";

const accounts: Account[] = [
  {
    id: 1,
    name: "Nubank",
    initial_balance: "0",
    balance: "0",
    currency: "BRL",
    bank: "nubank",
  },
  { id: 2, name: "Carteira", initial_balance: "0", balance: "0", currency: "BRL", bank: null },
];
const categories: Category[] = [{ id: 5, name: "Mercado", color: "#2a78d6", icon: "🛒" }];

const months: MonthTotals[] = Array.from({ length: 12 }, (_, i) => ({
  month: i + 1,
  income: i === 2 ? "1000.00" : "0.00",
  expense: i === 2 ? "250.50" : "0.00",
}));

const march: Transaction[] = [
  {
    id: 10,
    description: "Supermercado",
    amount: "250.50",
    type: "expense",
    date: "2026-03-15",
    account_id: 1,
    category_id: 5,
    budget_item_id: null,
  },
  {
    id: 11,
    description: "Salário",
    amount: "1000.00",
    type: "income",
    date: "2026-03-05",
    account_id: 1,
    category_id: null,
    budget_item_id: null,
  },
];

function setup(extra: Parameters<typeof mockApi>[0] = {}) {
  return mockApi({
    "GET /api/accounts": () => ({ body: accounts }),
    "GET /api/categories": () => ({ body: categories }),
    "GET /api/budgets": () => ({ body: [] }),
    "GET /api/transactions": () => ({ body: march }),
    "GET /api/reports/monthly": () => ({ body: months }),
    ...extra,
  });
}

function lastUrl(spy: ReturnType<typeof mockApi>, path: string): URL {
  const call = [...spy.mock.calls].reverse().find(([input]) => String(input).includes(path));
  return new URL(String(call?.[0]), "http://localhost");
}

describe("Transactions page", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 2, 20) });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists the month's records with totals", async () => {
    const spy = setup();
    renderApp("/lancamentos");

    const records = await screen.findByRole("region", { name: /registros — março de 2026/i });
    const rows = within(records).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("15/03/2026");
    expect(rows[1]).toHaveTextContent("Supermercado");
    expect(rows[1]).toHaveTextContent("🛒");
    expect(rows[1]).toHaveTextContent("Nubank");
    expect(rows[1]).toHaveTextContent("− R$ 250,50");
    expect(rows[2]).toHaveTextContent("Sem categoria");
    expect(rows[2]).toHaveTextContent("+ R$ 1.000,00");

    const summary = screen.getByRole("region", { name: /resumo: março de 2026/i });
    expect(summary).toHaveTextContent("R$ 1.000,00");
    expect(summary).toHaveTextContent("R$ 250,50");
    expect(summary).toHaveTextContent("R$ 749,50");

    const url = lastUrl(spy, "/api/transactions");
    expect(url.searchParams.get("year")).toBe("2026");
    expect(url.searchParams.get("month")).toBe("3");
  });

  it("shows the whole year with a monthly breakdown", async () => {
    const spy = setup();
    renderApp("/lancamentos");
    await screen.findByRole("region", { name: /registros/i });

    await userEvent.selectOptions(screen.getByLabelText("Mês"), "0");
    await userEvent.selectOptions(screen.getByLabelText("Ano"), "2025");

    const monthly = await screen.findByRole("region", { name: /resumo mensal de 2025/i });
    expect(within(monthly).getAllByRole("row")).toHaveLength(13);
    const url = lastUrl(spy, "/api/transactions");
    expect(url.searchParams.get("year")).toBe("2025");
    expect(url.searchParams.has("month")).toBe(false);

    // Clicking a month drills into it.
    await userEvent.click(within(monthly).getByRole("button", { name: "Março" }));
    expect(await screen.findByRole("region", { name: /registros — março de 2025/i })).toBeVisible();
  });

  it("adds an expense for the chosen month, year, category and account", async () => {
    const spy = setup({
      "POST /api/transactions": (init) => ({
        status: 201,
        body: { id: 99, ...JSON.parse(String(init?.body)) },
      }),
    });
    renderApp("/lancamentos");

    await userEvent.click(await screen.findByRole("button", { name: "+ Nova despesa" }));
    const form = screen.getByRole("form", { name: "Novo lançamento" });

    await userEvent.type(within(form).getByLabelText("Descrição"), "Feira");
    await userEvent.type(within(form).getByLabelText("Valor"), "42.90");
    await userEvent.selectOptions(within(form).getByLabelText("Mês"), "2");
    await userEvent.selectOptions(within(form).getByLabelText("Ano"), "2025");
    await userEvent.selectOptions(within(form).getByLabelText("Categoria"), "5");
    await userEvent.selectOptions(within(form).getByLabelText("Saiu da conta"), "2");
    await userEvent.click(within(form).getByRole("button", { name: "Adicionar despesa" }));

    const post = spy.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      description: "Feira",
      amount: "42.9",
      type: "expense",
      // Day defaults to today's (20), kept when switching to another month.
      date: "2025-02-20",
      account_id: 2,
      category_id: 5,
      budget_item_id: null,
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Lançamento adicionado em Fevereiro de 2025.",
    );
  });

  it("links a new expense to the month's budget", async () => {
    const marchBudget = {
      id: 8,
      year: 2026,
      month: 3,
      currency: "BRL" as const,
      planned: "100.00",
      spent: "0.00",
      available: "100.00",
      items: [{ id: 80, name: "Taxas", planned: "100.00", spent: "0.00", available: "100.00" }],
    };
    const spy = setup({
      "GET /api/budgets": () => ({ body: [marchBudget] }),
      "POST /api/transactions": (init) => ({
        status: 201,
        body: { id: 99, ...JSON.parse(String(init?.body)) },
      }),
    });
    renderApp("/lancamentos?nova=1");

    const form = await screen.findByRole("form", { name: "Novo lançamento" });
    await userEvent.type(within(form).getByLabelText("Descrição"), "Tarifa");
    await userEvent.type(within(form).getByLabelText("Valor"), "12");
    await userEvent.selectOptions(within(form).getByLabelText("Item do orçamento"), "80");
    await userEvent.click(within(form).getByRole("button", { name: "Adicionar despesa" }));

    const post = spy.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({ budget_item_id: 80 });

    // Another month has no budget, so the field disappears.
    await userEvent.selectOptions(within(form).getByLabelText("Mês"), "4");
    expect(within(form).queryByLabelText("Item do orçamento")).not.toBeInTheDocument();
  });

  it("can record income instead of an expense", async () => {
    const spy = setup({
      "POST /api/transactions": (init) => ({
        status: 201,
        body: { id: 99, ...JSON.parse(String(init?.body)) },
      }),
    });
    renderApp("/lancamentos?nova=1");

    const form = await screen.findByRole("form", { name: "Novo lançamento" });
    await userEvent.click(within(form).getByRole("radio", { name: "Receita" }));
    await userEvent.type(within(form).getByLabelText("Descrição"), "Freela");
    await userEvent.type(within(form).getByLabelText("Valor"), "500");
    await userEvent.click(within(form).getByRole("button", { name: "Adicionar receita" }));

    const post = spy.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
      type: "income",
      date: "2026-03-20",
      account_id: 1,
      category_id: null,
    });
  });

  it("deletes a record after confirmation", async () => {
    const spy = setup({ "DELETE /api/transactions/10": () => ({ status: 204 }) });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderApp("/lancamentos");

    await userEvent.click(await screen.findByRole("button", { name: "Excluir Supermercado" }));

    expect(spy.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
  });
});
