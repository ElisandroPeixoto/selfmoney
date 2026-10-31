import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import type { Account, Budget, BudgetTemplate, Transaction } from "../api/client";
import { mockApi, renderApp } from "../test/utils";

const account: Account = {
  id: 1,
  name: "Nubank",
  initial_balance: "0",
  balance: "0",
  currency: "BRL",
  bank: "nubank",
};

const template: BudgetTemplate = {
  id: 3,
  name: "Padrão",
  items: [{ name: "Cartão de crédito", planned: "1000.00" }],
};

function budget(overrides: Partial<Budget> = {}): Budget {
  return {
    id: 7,
    year: 2026,
    month: 10,
    currency: "BRL",
    saving: "0.00",
    auto_extras: false,
    income: "0.00",
    extras: null,
    planned: "1000.00",
    spent: "0.00",
    available: "1000.00",
    items: [
      { id: 70, name: "Cartão de crédito", is_extras: false, planned: "1000.00", spent: "0.00", available: "1000.00" },
    ],
    ...overrides,
  };
}

const expense: Transaction = {
  id: 50,
  description: "Fatura",
  amount: "400.00",
  type: "expense",
  date: "2026-10-10",
  account_id: 1,
  category_id: null,
  budget_item_id: null,
};

function body(init: RequestInit | undefined) {
  return JSON.parse(String(init?.body));
}

const baseRoutes = {
  "GET /api/accounts": () => ({ body: [account] }),
  "GET /api/categories": () => ({ body: [] }),
  "GET /api/budget-templates": () => ({ body: [template] }),
};

describe("Budgets page", () => {
  it("creates a month's budget from a saved template and opens it", async () => {
    const spy = mockApi({
      ...baseRoutes,
      "GET /api/budgets": () => ({ body: [] }),
      "POST /api/budgets": () => ({ status: 201, body: budget() }),
      "GET /api/budgets/7": () => ({ body: budget() }),
      "GET /api/transactions": () => ({ body: [] }),
    });
    renderApp("/orcamentos");

    const form = await screen.findByRole("form", { name: "Novo orçamento" });
    await userEvent.selectOptions(within(form).getByLabelText("Mês"), "10");
    await userEvent.selectOptions(within(form).getByLabelText("Ano"), "2026");
    await userEvent.selectOptions(within(form).getByLabelText("Começar com"), "template:3");
    await userEvent.click(within(form).getByRole("button", { name: "Criar orçamento" }));

    const post = spy.mock.calls.find(([, init]) => init?.method === "POST");
    expect(body(post?.[1])).toEqual({
      year: 2026,
      month: 10,
      currency: "BRL",
      template_id: 3,
      source_budget_id: null,
    });
    expect(
      await screen.findByRole("heading", { name: "Orçamento de Outubro de 2026" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Cartão de crédito")).toBeInTheDocument();
  });

  it("reports when the month already has a budget", async () => {
    mockApi({
      ...baseRoutes,
      "GET /api/budgets": () => ({ body: [] }),
      "POST /api/budgets": () => ({ status: 409 }),
    });
    renderApp("/orcamentos");

    const form = await screen.findByRole("form", { name: "Novo orçamento" });
    await userEvent.click(within(form).getByRole("button", { name: "Criar orçamento" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent(/já tem um orçamento/);
  });

  it("adds a category to the budget", async () => {
    const spy = mockApi({
      ...baseRoutes,
      "GET /api/budgets": () => ({ body: [budget()] }),
      "GET /api/budgets/7": () => ({ body: budget() }),
      "GET /api/transactions": () => ({ body: [] }),
      "POST /api/budgets/7/items": (init) => ({
        status: 201,
        body: budget({
          planned: "1080.00",
          available: "1080.00",
          items: [
            ...budget().items,
            { id: 71, name: body(init).name, is_extras: false, planned: "80.00", spent: "0.00", available: "80.00" },
          ],
        }),
      }),
    });
    renderApp("/orcamentos/7");

    await userEvent.type(await screen.findByLabelText("Nova categoria"), "Assinaturas");
    await userEvent.type(screen.getByLabelText("Valor planejado"), "8000");
    await userEvent.click(screen.getByRole("button", { name: "Adicionar" }));

    expect(await screen.findByText("Assinaturas")).toBeInTheDocument();
    const post = spy.mock.calls.find(([, init]) => init?.method === "POST");
    expect(body(post?.[1])).toEqual({ name: "Assinaturas", planned: "80.00" });
    const summary = screen.getByRole("region", { name: "Resumo do orçamento" });
    expect(summary).toHaveTextContent("R$ 1.080,00");
  });

  it("adds a category planned at zero", async () => {
    const spy = mockApi({
      ...baseRoutes,
      "GET /api/budgets": () => ({ body: [budget()] }),
      "GET /api/budgets/7": () => ({ body: budget() }),
      "GET /api/transactions": () => ({ body: [] }),
      "POST /api/budgets/7/items": (init) => ({
        status: 201,
        body: budget({
          items: [
            ...budget().items,
            { id: 72, name: body(init).name, is_extras: false, planned: "0.00", spent: "0.00", available: "0.00" },
          ],
        }),
      }),
    });
    renderApp("/orcamentos/7");

    await userEvent.type(await screen.findByLabelText("Nova categoria"), "Viagem");
    await userEvent.type(screen.getByLabelText("Valor planejado"), "0");
    await userEvent.click(screen.getByRole("button", { name: "Adicionar" }));

    expect(await screen.findByText("Viagem")).toBeInTheDocument();
    const post = spy.mock.calls.find(([, init]) => init?.method === "POST");
    expect(body(post?.[1])).toEqual({ name: "Viagem", planned: "0.00" });
  });

  it("adds the Extras category and edits the saving", async () => {
    const extrasItem = (saving: number) => ({
      id: 73,
      name: "Extras",
      is_extras: true,
      planned: (4000 - 1000 - saving).toFixed(2),
      spent: "0.00",
      available: (4000 - 1000 - saving).toFixed(2),
    });
    let current = budget({ income: "4000.00" });
    const spy = mockApi({
      ...baseRoutes,
      "GET /api/budgets": () => ({ body: [current] }),
      "GET /api/budgets/7": () => ({ body: current }),
      "GET /api/transactions": () => ({ body: [] }),
      "PATCH /api/budgets/7": (init) => {
        const changes = body(init);
        const saving = changes.saving ?? current.saving;
        const autoExtras = changes.auto_extras ?? current.auto_extras;
        current = {
          ...current,
          saving,
          auto_extras: autoExtras,
          extras: autoExtras ? (4000 - 1000 - Number(saving)).toFixed(2) : null,
          items: [...budget().items, ...(autoExtras ? [extrasItem(Number(saving))] : [])],
        };
        return { body: current };
      },
    });
    renderApp("/orcamentos/7");

    await userEvent.click(await screen.findByRole("button", { name: "Adicionar Extras" }));
    const breakdown = await screen.findByLabelText("Cálculo dos extras");
    expect(breakdown).toHaveTextContent("R$ 3.000,00");
    expect(screen.getByLabelText("Gasto em Extras")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Adicionar Extras" })).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Saving do mês"), "50000");
    await userEvent.click(screen.getByRole("button", { name: "Salvar saving" }));

    expect(await screen.findByLabelText("Cálculo dos extras")).toHaveTextContent("R$ 2.500,00");
    const patches = spy.mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(body(patches[0][1])).toEqual({ auto_extras: true });
    expect(body(patches[1][1])).toEqual({ saving: "500.00" });
  });

  it("associates an expense with a budget category and refreshes the totals", async () => {
    let linked = false;
    const spy = mockApi({
      ...baseRoutes,
      "GET /api/budgets": () => ({ body: [budget()] }),
      "GET /api/budgets/7": () => ({
        body: linked
          ? budget({
              spent: "400.00",
              available: "600.00",
              items: [{ ...budget().items[0], spent: "400.00", available: "600.00" }],
            })
          : budget(),
      }),
      "GET /api/transactions": () => ({ body: [expense] }),
      "PATCH /api/transactions/50": (init) => {
        linked = true;
        return { body: { ...expense, ...body(init) } };
      },
    });
    renderApp("/orcamentos/7");

    expect(await screen.findByText(/1 despesa ainda não está associada/)).toBeInTheDocument();
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Item do orçamento para Fatura" }),
      "70",
    );

    const patch = spy.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(body(patch?.[1])).toEqual({ budget_item_id: 70 });
    // Updated both in the detail and in the budget list.
    expect(await screen.findAllByText("Disponível: R$ 600,00")).toHaveLength(2);
    expect(screen.queryByText(/ainda não está associada/)).not.toBeInTheDocument();
  });

  it("shows overspending in text", async () => {
    mockApi({
      ...baseRoutes,
      "GET /api/budgets": () => ({ body: [] }),
      "GET /api/budgets/7": () => ({
        body: budget({
          spent: "1200.00",
          available: "-200.00",
          items: [{ ...budget().items[0], spent: "1200.00", available: "-200.00" }],
        }),
      }),
      "GET /api/transactions": () => ({ body: [] }),
    });
    renderApp("/orcamentos/7");
    expect(await screen.findByText("Excedido em R$ 200,00")).toBeInTheDocument();
  });

  it("saves the budget structure as a reusable template", async () => {
    const spy = mockApi({
      ...baseRoutes,
      "GET /api/budgets": () => ({ body: [budget()] }),
      "GET /api/budgets/7": () => ({ body: budget() }),
      "GET /api/transactions": () => ({ body: [] }),
      "POST /api/budgets/7/save-template": (init) => ({
        status: 201,
        body: { id: 4, name: body(init).name, items: template.items },
      }),
    });
    vi.spyOn(window, "prompt").mockReturnValue("Mês típico");
    renderApp("/orcamentos/7");

    await userEvent.click(await screen.findByRole("button", { name: "Salvar como modelo" }));

    expect(await screen.findByRole("status")).toHaveTextContent('Modelo "Mês típico" salvo');
    const templates = screen.getByRole("region", { name: "Modelos salvos" });
    expect(within(templates).getByText("Mês típico")).toBeInTheDocument();
    expect(spy.mock.calls.some(([input]) => String(input).includes("save-template"))).toBe(true);
  });
});
