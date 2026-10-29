import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import type { Budget, DashboardSummary, MonthTotals } from "../api/client";
import { mockApi, renderApp } from "../test/utils";

const summary: DashboardSummary = {
  year: 2026,
  month: 10,
  balances_by_currency: [{ currency: "BRL", total: "12650.50" }],
  currency: "BRL",
  month_expenses: "300.00",
  accounts: [
    {
      id: 1,
      name: "Conta Corrente",
      initial_balance: "2500.00",
      balance: "2500.50",
      currency: "BRL",
      bank: "nubank",
    },
    {
      id: 2,
      name: "Poupança",
      initial_balance: "10150.00",
      balance: "10150.00",
      currency: "BRL",
      bank: null,
    },
  ],
  spending_by_category: [
    {
      category_id: 1,
      name: "Moradia",
      color: "#2a78d6",
      icon: "🏠",
      total: "200.00",
    },
    {
      category_id: 2,
      name: "Alimentação",
      color: "#eb6834",
      icon: null,
      total: "100.00",
    },
  ],
};

const emptyYear: MonthTotals[] = Array.from({ length: 12 }, (_, i) => ({
  month: i + 1,
  income: "0.00",
  expense: "0.00",
}));

// Routes every dashboard render needs besides the summary.
const noBudgets = {
  "GET /api/budgets": () => ({ body: [] }),
  "GET /api/reports/monthly": () => ({ body: emptyYear }),
};

describe("Dashboard", () => {
  it("renders account balances with bank logos and spending by category", async () => {
    const fetchSpy = mockApi({
      ...noBudgets,
      "GET /api/dashboard/summary": () => ({ body: summary }),
    });
    renderApp();

    expect(await screen.findByTestId("total-balance")).toHaveTextContent(
      "R$ 12.650,50",
    );
    // One card per account: bank, account name and balance.
    const cards = within(
      screen.getByRole("list", { name: "Contas" }),
    ).getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    expect(
      within(cards[0]).getByRole("img", { name: "Nubank" }),
    ).toBeInTheDocument();
    expect(cards[0]).toHaveTextContent("Nubank");
    expect(cards[0]).toHaveTextContent("Conta Corrente");
    expect(cards[0]).toHaveTextContent("R$ 2.500,50");
    expect(cards[1]).toHaveTextContent("Sem banco");
    expect(cards[1]).toHaveTextContent("Poupança");

    const table = within(
      screen.getByRole("region", { name: /gastos do mês/i }),
    ).getByRole("table");
    expect(table).toHaveTextContent("Moradia");
    expect(table).toHaveTextContent("R$ 200,00");
    expect(table).toHaveTextContent("66,7%");

    const summaryCall = fetchSpy.mock.calls.find(([u]) =>
      String(u).includes("/summary"),
    );
    expect(String(summaryCall?.[0])).toMatch(
      /\/api\/dashboard\/summary\?year=\d+&month=\d+&currency=BRL/,
    );
    // Only one currency: no selector.
    expect(
      screen.queryByRole("combobox", { name: /moeda/i }),
    ).not.toBeInTheDocument();
  });

  it("shows one total per currency and lets the chart switch currency", async () => {
    const multi: DashboardSummary = {
      ...summary,
      balances_by_currency: [
        { currency: "BRL", total: "100.00" },
        { currency: "USD", total: "50.00" },
      ],
    };
    const fetchSpy = mockApi({
      ...noBudgets,
      "GET /api/dashboard/summary": () => ({ body: multi }),
    });
    renderApp();

    const totals = await screen.findByTestId("total-balance");
    expect(totals).toHaveTextContent("R$ 100,00");
    expect(totals).toHaveTextContent("US$ 50,00");

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Moeda do gráfico" }),
      "USD",
    );
    expect(String(fetchSpy.mock.lastCall?.[0])).toContain("currency=USD");
  });

  it("lets the spending chart show another month and year", async () => {
    const fetchSpy = mockApi({
      ...noBudgets,
      "GET /api/dashboard/summary": () => ({ body: summary }),
    });
    renderApp();
    await screen.findByTestId("total-balance");

    const card = screen.getByRole("region", { name: /gastos do mês/i });
    await userEvent.selectOptions(
      within(card).getByRole("combobox", { name: "Mês do gráfico de gastos" }),
      "3",
    );
    const year = within(card).getByRole("combobox", {
      name: "Ano do gráfico de gastos",
    });
    await userEvent.selectOptions(year, String(new Date().getFullYear() - 1));

    const url = new URL(
      String(fetchSpy.mock.lastCall?.[0]),
      "http://localhost",
    );
    expect(url.searchParams.get("month")).toBe("3");
    expect(url.searchParams.get("year")).toBe(
      String(new Date().getFullYear() - 1),
    );
    expect(
      within(card).getByRole("combobox", { name: "Mês do gráfico de gastos" }),
    ).toHaveValue("3");
  });

  it("shows an empty state when there are no expenses", async () => {
    mockApi({
      ...noBudgets,
      "GET /api/dashboard/summary": () => ({
        body: { ...summary, spending_by_category: [], month_expenses: "0.00" },
      }),
    });
    renderApp();
    expect(
      await screen.findByText(/nenhum gasto registrado/i),
    ).toBeInTheDocument();
  });

  it("shows an error when the API fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockApi({
      ...noBudgets,
      "GET /api/dashboard/summary": () => ({ status: 500 }),
    });
    renderApp();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /não foi possível/i,
    );
  });
});

function budget(
  id: number,
  year: number,
  month: number,
  items: Budget["items"],
): Budget {
  return {
    id,
    year,
    month,
    currency: "BRL",
    planned: "0",
    spent: "0",
    available: "0",
    items,
  };
}

const item = (id: number, name: string, planned: string, spent: string) => ({
  id,
  name,
  planned,
  spent,
  available: (Number(planned) - Number(spent)).toFixed(2),
});

describe("Dashboard budget chart", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 15) });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const october = budget(1, 2026, 10, [
    item(10, "Cartão de crédito", "1000", "500"),
    item(11, "Assinaturas", "100", "85"),
    item(12, "Taxas", "50", "60"),
  ]);
  const september = budget(2, 2026, 9, [item(20, "Mercado", "800", "100")]);

  function renderWithBudgets(budgets: Budget[]) {
    mockApi({
      ...noBudgets,
      "GET /api/budgets": () => ({ body: budgets }),
      "GET /api/dashboard/summary": () => ({ body: summary }),
    });
    renderApp();
    return screen.findByRole("region", { name: "Orçamento por categoria" });
  }

  it("opens on the current month's budget and shows each category's status", async () => {
    const card = await renderWithBudgets([october, september]);

    expect(
      within(card).getByRole("combobox", { name: "Orçamento exibido" }),
    ).toHaveValue("1");
    const rows = within(card).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringMatching(/^Cartão de crédito.*50%Dentro do planejado$/),
      expect.stringMatching(/^Assinaturas.*85%Perto do limite$/),
      expect.stringMatching(/^Taxas.*120%Limite excedido$/),
    ]);
    expect(card).toHaveTextContent("2 de 3 categorias dentro do limite");
  });

  it("switches to another budget", async () => {
    const card = await renderWithBudgets([october, september]);

    await userEvent.selectOptions(
      within(card).getByRole("combobox", { name: "Orçamento exibido" }),
      "2",
    );
    const rows = within(card).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Mercado");
  });

  it("switches between percent and money views", async () => {
    const card = await renderWithBudgets([october]);
    const percent = within(card).getByRole("button", {
      name: "Ver em percentual",
    });
    const amount = within(card).getByRole("button", { name: "Ver em valores" });

    expect(percent).toHaveAttribute("aria-pressed", "true");
    expect(amount).toHaveTextContent("R$");
    expect(
      within(card).getByRole("img", { name: /em percentual$/ }),
    ).toBeInTheDocument();

    await userEvent.click(amount);
    expect(amount).toHaveAttribute("aria-pressed", "true");
    expect(percent).toHaveAttribute("aria-pressed", "false");
    expect(
      within(card).getByRole("img", { name: /em valores$/ }),
    ).toBeInTheDocument();
    expect(within(card).getByText("Restante até o limite")).toBeInTheDocument();
  });

  it("falls back to the most recent budget", async () => {
    const card = await renderWithBudgets([september]);
    expect(
      within(card).getByRole("combobox", { name: "Orçamento exibido" }),
    ).toHaveValue("2");
  });

  it("invites the user to create a budget when there is none", async () => {
    const card = await renderWithBudgets([]);
    expect(
      within(card).getByRole("link", { name: "Criar um orçamento" }),
    ).toHaveAttribute("href", "/orcamentos");
  });
});

describe("Dashboard income vs expense chart", () => {
  const year = emptyYear.map((m) =>
    m.month === 1
      ? { month: 1, income: "5000.00", expense: "3200.50" }
      : m.month === 2
        ? { month: 2, income: "5000.00", expense: "6000.00" }
        : m,
  );

  it("compares income and expenses month by month", async () => {
    mockApi({
      ...noBudgets,
      "GET /api/dashboard/summary": () => ({ body: summary }),
      "GET /api/reports/monthly": () => ({ body: year }),
    });
    renderApp();

    const card = await screen.findByRole("region", {
      name: "Receitas vs despesas",
    });
    const totals = await within(card).findByTestId("income-expense-totals");
    expect(totals).toHaveTextContent("Receitas R$ 10.000,00");
    expect(totals).toHaveTextContent("Despesas R$ 9.200,50");
    expect(totals).toHaveTextContent("Saldo do ano R$ 799,50");
    expect(
      within(card).getByRole("img", { name: /receitas e despesas por mês/i }),
    ).toBeInTheDocument();

    const rows = within(card).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(12);
    expect(rows[0]).toHaveTextContent(
      "JaneiroR$ 5.000,00R$ 3.200,50R$ 1.799,50",
    );
    expect(rows[1]).toHaveTextContent(
      "FevereiroR$ 5.000,00R$ 6.000,00-R$ 1.000,00",
    );
  });

  it("loads another year", async () => {
    const fetchSpy = mockApi({
      ...noBudgets,
      "GET /api/dashboard/summary": () => ({ body: summary }),
    });
    renderApp();

    const card = await screen.findByRole("region", {
      name: "Receitas vs despesas",
    });
    expect(
      await within(card).findByText(/nenhum lançamento em/i),
    ).toBeInTheDocument();

    const previous = String(new Date().getFullYear() - 1);
    await userEvent.selectOptions(
      within(card).getByRole("combobox", {
        name: "Ano do gráfico de receitas e despesas",
      }),
      previous,
    );
    const call = fetchSpy.mock.calls
      .filter(([u]) => String(u).includes("/reports/monthly"))
      .pop();
    const url = new URL(String(call?.[0]), "http://localhost");
    expect(url.searchParams.get("year")).toBe(previous);
    expect(url.searchParams.get("currency")).toBe("BRL");
  });
});
