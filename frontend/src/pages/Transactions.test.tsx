import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import type { Account, Budget, Category, MonthTotals, Transaction } from "../api/client";
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
  {
    id: 2,
    name: "Carteira",
    initial_balance: "0",
    balance: "0",
    currency: "BRL",
    bank: null,
  },
];
const categories: Category[] = [
  { id: 5, name: "Mercado", color: "#2a78d6", icon: "🛒", kind: "expense" },
  { id: 6, name: "Freelas", color: "#008300", icon: null, kind: "income" },
];

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

const marchBudget: Budget = {
  id: 8,
  year: 2026,
  month: 3,
  currency: "BRL",
  planned: "100.00",
  spent: "0.00",
  available: "100.00",
  items: [
    {
      id: 80,
      name: "Taxas",
      planned: "100.00",
      spent: "0.00",
      available: "100.00",
    },
  ],
};

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

    const records = await screen.findByRole("region", {
      name: /registros — março de 2026/i,
    });
    const rows = within(records).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("15/03/2026");
    expect(rows[1]).toHaveTextContent("Supermercado");
    expect(rows[1]).toHaveTextContent("🛒");
    expect(rows[1]).toHaveTextContent("Nubank");
    expect(rows[1]).toHaveTextContent("− R$ 250,50");
    expect(rows[2]).toHaveTextContent("Sem categoria");
    expect(rows[2]).toHaveTextContent("+ R$ 1.000,00");

    const summary = screen.getByRole("region", {
      name: /resumo: março de 2026/i,
    });
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

    const monthly = await screen.findByRole("region", {
      name: /resumo mensal de 2025/i,
    });
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

    await userEvent.click(await screen.findByRole("button", { name: "+ Novo lançamento" }));
    const form = screen.getByRole("form", { name: "Novo lançamento" });

    await userEvent.type(within(form).getByLabelText("Descrição"), "Feira");
    await userEvent.type(within(form).getByLabelText("Valor"), "4290");
    expect(within(form).getByLabelText("Valor")).toHaveValue("42,90");
    await userEvent.selectOptions(within(form).getByLabelText("Mês"), "2");
    await userEvent.selectOptions(within(form).getByLabelText("Ano"), "2025");
    await userEvent.selectOptions(within(form).getByLabelText("Categoria"), "5");
    await userEvent.selectOptions(within(form).getByLabelText("Saiu da conta"), "2");
    await userEvent.click(within(form).getByRole("button", { name: "Adicionar despesa" }));

    const post = spy.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      description: "Feira",
      amount: "42.90",
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
    await userEvent.type(within(form).getByLabelText("Valor"), "1200");
    await userEvent.selectOptions(within(form).getByLabelText("Categoria do orçamento"), "80");
    await userEvent.click(within(form).getByRole("button", { name: "Adicionar despesa" }));

    const post = spy.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
      budget_item_id: 80,
    });

    // Another month has no budget: the field explains why and how to create one.
    await userEvent.selectOptions(within(form).getByLabelText("Mês"), "4");
    expect(within(form).queryByLabelText("Categoria do orçamento")).not.toBeInTheDocument();
    expect(within(form).getByTestId("budget-link-note")).toHaveTextContent(
      "Sem orçamento em Abril de 2026.",
    );
    expect(within(form).getByRole("link", { name: "Criar orçamento" })).toHaveAttribute(
      "href",
      "/orcamentos",
    );
  });

  it("points to the budget when it has no categories yet", async () => {
    setup({
      "GET /api/budgets": () => ({ body: [{ ...marchBudget, items: [] }] }),
    });
    renderApp("/lancamentos?nova=1");

    const form = await screen.findByRole("form", { name: "Novo lançamento" });
    expect(within(form).getByTestId("budget-link-note")).toHaveTextContent(
      "O orçamento de Março de 2026 não tem categorias.",
    );
    expect(within(form).getByRole("link", { name: "Adicionar categorias" })).toHaveAttribute(
      "href",
      "/orcamentos/8",
    );
  });

  it("links an expense to a budget category straight from the list", async () => {
    const spy = setup({
      "GET /api/budgets": () => ({ body: [marchBudget] }),
      "PATCH /api/transactions/10": (init) => ({
        body: { ...march[0], ...JSON.parse(String(init?.body)) },
      }),
    });
    renderApp("/lancamentos");

    const select = await screen.findByRole("combobox", {
      name: "Categoria do orçamento de Supermercado",
    });
    expect(select).toHaveValue("");
    // Income never counts against a budget.
    expect(
      screen.queryByRole("combobox", {
        name: "Categoria do orçamento de Salário",
      }),
    ).not.toBeInTheDocument();

    await userEvent.selectOptions(select, "80");
    const patch = spy.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({
      budget_item_id: 80,
    });
    expect(select).toHaveValue("80");

    await userEvent.selectOptions(select, "");
    expect(JSON.parse(String(spy.mock.lastCall?.[1]?.body))).toEqual({
      budget_item_id: null,
    });
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
    const categoryOptions = () =>
      within(within(form).getByLabelText("Categoria"))
        .getAllByRole("option")
        .map((o) => o.textContent);
    expect(categoryOptions()).toEqual(["Sem categoria", "🛒 Mercado"]);

    await userEvent.click(within(form).getByRole("radio", { name: "Receita" }));
    // Income shows only income categories.
    expect(categoryOptions()).toEqual(["Sem categoria", "Freelas"]);
    await userEvent.type(within(form).getByLabelText("Descrição"), "Freela");
    await userEvent.type(within(form).getByLabelText("Valor"), "50000");
    await userEvent.click(within(form).getByRole("button", { name: "Adicionar receita" }));

    const post = spy.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
      type: "income",
      date: "2026-03-20",
      account_id: 1,
      category_id: null,
    });
  });

  it("edits an existing record", async () => {
    const spy = setup({
      "PATCH /api/transactions/10": (init) => ({
        body: { ...march[0], ...JSON.parse(String(init?.body)) },
      }),
    });
    renderApp("/lancamentos");

    await userEvent.click(await screen.findByRole("button", { name: "Editar Supermercado" }));
    const form = screen.getByRole("form", { name: "Editar lançamento" });

    // The form starts from the record's current values.
    expect(screen.getByRole("heading", { name: "Editar despesa" })).toBeInTheDocument();
    expect(within(form).getByLabelText("Descrição")).toHaveValue("Supermercado");
    expect(within(form).getByLabelText("Valor")).toHaveValue("250,50");
    expect(within(form).getByLabelText("Mês")).toHaveValue("3");
    expect(within(form).getByLabelText("Dia")).toHaveValue(15);
    expect(within(form).getByLabelText("Categoria")).toHaveValue("5");
    expect(within(form).getByLabelText("Saiu da conta")).toHaveValue("1");

    const description = within(form).getByLabelText("Descrição");
    await userEvent.clear(description);
    await userEvent.type(description, "Supermercado do mês");
    await userEvent.type(within(form).getByLabelText("Valor"), "0");
    await userEvent.selectOptions(within(form).getByLabelText("Saiu da conta"), "2");
    await userEvent.click(within(form).getByRole("button", { name: "Salvar alterações" }));

    const patch = spy.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({
      description: "Supermercado do mês",
      amount: "2505.00",
      type: "expense",
      date: "2026-03-15",
      account_id: 2,
      category_id: 5,
      budget_item_id: null,
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Lançamento atualizado.");
    expect(screen.queryByRole("form", { name: "Editar lançamento" })).not.toBeInTheDocument();
  });

  it("cancels an edit without saving", async () => {
    const spy = setup();
    renderApp("/lancamentos");

    await userEvent.click(await screen.findByRole("button", { name: "Editar Salário" }));
    expect(screen.getByRole("heading", { name: "Editar receita" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("form", { name: "Editar lançamento" })).not.toBeInTheDocument();
    expect(spy.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  });

  it("deletes a record after confirmation", async () => {
    const spy = setup({
      "DELETE /api/transactions/10": () => ({ status: 204 }),
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderApp("/lancamentos");

    await userEvent.click(await screen.findByRole("button", { name: "Excluir Supermercado" }));

    expect(spy.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
  });
});
