import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import type { Account } from "../api/client";
import { mockApi, renderApp } from "../test/utils";

const brl: Account = {
  id: 1,
  name: "Nubank",
  initial_balance: "0",
  balance: "0",
  currency: "BRL",
  bank: "nubank",
};
const usd: Account = {
  ...brl,
  id: 2,
  name: "Wise",
  currency: "USD",
  bank: null,
};

const pdf = () => ({
  body: new Blob(["%PDF-1.4"], { type: "application/pdf" }),
  headers: {
    "Content-Disposition": 'attachment; filename="selfmoney-relatorio-2026-03-BRL.pdf"',
  },
});

describe("Reports page", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 2, 20) });
    URL.createObjectURL = vi.fn(() => "blob:report");
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is reachable from the sidebar", async () => {
    mockApi({ "GET /api/accounts": () => ({ body: [brl] }) });
    renderApp("/relatorios");
    expect(screen.getByRole("link", { name: "Relatórios" })).toHaveClass("active");
    expect(screen.getByRole("heading", { name: "Relatórios", level: 1 })).toBeInTheDocument();
  });

  it("downloads the PDF of the chosen month", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const spy = mockApi({
      "GET /api/accounts": () => ({ body: [brl] }),
      "GET /api/reports/monthly-pdf": pdf,
    });
    renderApp("/relatorios");

    const form = screen.getByRole("form", { name: "Gerar relatório mensal" });
    expect(within(form).getByLabelText("Mês")).toHaveValue("3");
    expect(within(form).getByLabelText("Ano")).toHaveValue("2026");
    await userEvent.selectOptions(within(form).getByLabelText("Mês"), "2");
    // A single currency needs no picker.
    expect(within(form).queryByLabelText("Moeda")).not.toBeInTheDocument();
    await userEvent.click(within(form).getByRole("button", { name: "Gerar PDF" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Relatório de Fevereiro de 2026 gerado: selfmoney-relatorio-2026-03-BRL.pdf",
    );
    const call = spy.mock.calls.find(([u]) => String(u).includes("monthly-pdf"));
    const url = new URL(String(call?.[0]), "http://localhost");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      year: "2026",
      month: "2",
      currency: "BRL",
      utc_offset: String(-new Date().getTimezoneOffset()),
    });
    expect(click).toHaveBeenCalledOnce();
    const link = click.mock.contexts[0] as HTMLAnchorElement;
    expect(link.download).toBe("selfmoney-relatorio-2026-03-BRL.pdf");
    expect(link.href).toBe("blob:report");
  });

  it("asks for the currency when accounts use more than one", async () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const spy = mockApi({
      "GET /api/accounts": () => ({ body: [brl, usd] }),
      "GET /api/reports/monthly-pdf": pdf,
    });
    renderApp("/relatorios");

    await userEvent.selectOptions(await screen.findByLabelText("Moeda"), "USD");
    await userEvent.click(screen.getByRole("button", { name: "Gerar PDF" }));
    await screen.findByRole("status");
    const call = spy.mock.calls.find(([u]) => String(u).includes("monthly-pdf"));
    expect(String(call?.[0])).toContain("currency=USD");
  });

  it("says when the report can't be generated", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockApi({
      "GET /api/accounts": () => ({ body: [brl] }),
      "GET /api/reports/monthly-pdf": () => ({ status: 500 }),
    });
    renderApp("/relatorios");

    await userEvent.click(screen.getByRole("button", { name: "Gerar PDF" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/não foi possível gerar/i);
    expect(screen.getByRole("button", { name: "Gerar PDF" })).toBeEnabled();
  });
});
