import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import type { DashboardSummary } from "../api/client";
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
    { category_id: 1, name: "Moradia", color: "#2a78d6", icon: "🏠", total: "200.00" },
    { category_id: 2, name: "Alimentação", color: "#eb6834", icon: null, total: "100.00" },
  ],
};

describe("Dashboard", () => {
  it("renders account balances with bank logos and spending by category", async () => {
    const fetchSpy = mockApi({ "GET /api/dashboard/summary": () => ({ body: summary }) });
    renderApp();

    expect(await screen.findByTestId("total-balance")).toHaveTextContent("R$ 12.650,50");
    expect(screen.getByText("Conta Corrente")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Nubank" })).toBeInTheDocument();

    const table = screen.getByRole("table");
    expect(table).toHaveTextContent("Moradia");
    expect(table).toHaveTextContent("R$ 200,00");
    expect(table).toHaveTextContent("66,7%");

    expect(String(fetchSpy.mock.calls[0][0])).toMatch(
      /\/api\/dashboard\/summary\?year=\d+&month=\d+&currency=BRL/,
    );
    // Only one currency: no selector.
    expect(screen.queryByRole("combobox", { name: /moeda/i })).not.toBeInTheDocument();
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
      "GET /api/dashboard/summary": () => ({ body: multi }),
    });
    renderApp();

    const totals = await screen.findByTestId("total-balance");
    expect(totals).toHaveTextContent("R$ 100,00");
    expect(totals).toHaveTextContent("US$ 50,00");

    await userEvent.selectOptions(screen.getByRole("combobox", { name: /moeda/i }), "USD");
    expect(String(fetchSpy.mock.lastCall?.[0])).toContain("currency=USD");
  });

  it("shows an empty state when there are no expenses", async () => {
    mockApi({
      "GET /api/dashboard/summary": () => ({
        body: { ...summary, spending_by_category: [], month_expenses: "0.00" },
      }),
    });
    renderApp();
    expect(await screen.findByText(/nenhum gasto registrado/i)).toBeInTheDocument();
  });

  it("shows an error when the API fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockApi({ "GET /api/dashboard/summary": () => ({ status: 500 }) });
    renderApp();
    expect(await screen.findByRole("alert")).toHaveTextContent(/não foi possível/i);
  });
});
