import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import type { Account, Movement } from "../api/client";
import { mockApi, renderApp } from "../test/utils";

const accounts: Account[] = [
  {
    id: 1,
    name: "Nubank",
    initial_balance: "0",
    balance: "1000.00",
    currency: "BRL",
    bank: "nubank",
  },
  { id: 2, name: "Poupança", initial_balance: "0", balance: "50.00", currency: "BRL", bank: null },
  { id: 3, name: "Wise", initial_balance: "0", balance: "10.00", currency: "USD", bank: null },
];

const log: Movement[] = [
  {
    id: 2,
    kind: "withdrawal",
    amount: "30.00",
    currency: "BRL",
    reason: "Saque para a feira",
    from_account_id: 1,
    to_account_id: null,
    from_account_name: "Nubank",
    to_account_name: null,
    created_at: "2026-10-20T15:30:00+00:00",
  },
  {
    id: 1,
    kind: "transfer",
    amount: "200.00",
    currency: "BRL",
    reason: "Fechando a conta antiga",
    from_account_id: null,
    to_account_id: 2,
    from_account_name: "Conta antiga",
    to_account_name: "Poupança",
    created_at: "2026-10-01T12:00:00+00:00",
  },
];

function body(init: RequestInit | undefined) {
  return JSON.parse(String(init?.body));
}

function setup(extra: Parameters<typeof mockApi>[0] = {}) {
  return mockApi({
    "GET /api/accounts": () => ({ body: accounts }),
    "GET /api/movements": () => ({ body: log }),
    ...extra,
  });
}

describe("Movements page", () => {
  it("is reachable from the sidebar", async () => {
    setup({ "GET /api/categories": () => ({ body: [] }) });
    renderApp("/categorias");
    await userEvent.click(screen.getByRole("link", { name: /movimentações/i }));
    expect(screen.getByRole("heading", { level: 1, name: "Movimentações" })).toBeInTheDocument();
  });

  it("transfers between accounts after a justification and confirmation", async () => {
    const spy = setup({
      "POST /api/movements/transfer": (init) => ({
        status: 201,
        body: { ...log[1], id: 9, kind: "transfer", ...body(init) },
      }),
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderApp("/movimentacoes");

    const form = await screen.findByRole("form", { name: "Transferir" });
    // Destination list excludes the source and accounts in other currencies.
    const to = within(form).getByLabelText("Para");
    const options = within(to).getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("Poupança — R$ 50,00");

    await userEvent.type(within(form).getByLabelText("Valor"), "250");
    const submit = within(form).getByRole("button", { name: "Transferir" });
    expect(submit).toBeDisabled();
    await userEvent.type(within(form).getByLabelText(/justificativa/i), "Reserva");
    expect(within(form).getByText("R$ 300,00")).toBeInTheDocument(); // Poupança after
    await userEvent.click(submit);

    // Intl puts a non-breaking space after "R$".
    expect(String(confirm.mock.calls[0][0]).replace(/\s/g, " ")).toContain(
      "Transferir R$ 250,00 de Nubank para Poupança?",
    );
    const post = spy.mock.calls.find(([, init]) => init?.method === "POST");
    expect(body(post?.[1])).toEqual({
      amount: "250",
      reason: "Reserva",
      from_account_id: 1,
      to_account_id: 2,
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Transferência registrada no histórico.",
    );
  });

  it("adds money to an account without a month", async () => {
    const spy = setup({
      "POST /api/movements/deposit": (init) => ({
        status: 201,
        body: { ...log[0], id: 10, kind: "deposit", ...body(init) },
      }),
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderApp("/movimentacoes");

    await userEvent.click(await screen.findByRole("tab", { name: "Adicionar dinheiro" }));
    const form = screen.getByRole("form", { name: "Adicionar dinheiro" });
    await userEvent.selectOptions(within(form).getByLabelText("Conta"), "2");
    await userEvent.type(within(form).getByLabelText("Valor"), "80");
    await userEvent.type(within(form).getByLabelText(/justificativa/i), "Reembolso do almoço");
    await userEvent.click(within(form).getByRole("button", { name: "Adicionar" }));

    const post = spy.mock.calls.find(([, init]) => init?.method === "POST");
    expect(body(post?.[1])).toEqual({ amount: "80", reason: "Reembolso do almoço", account_id: 2 });
  });

  it("warns when a withdrawal leaves the balance negative and does nothing if cancelled", async () => {
    const spy = setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderApp("/movimentacoes?tipo=withdrawal");

    const form = await screen.findByRole("form", { name: "Retirar dinheiro" });
    await userEvent.selectOptions(within(form).getByLabelText("Conta"), "2");
    await userEvent.type(within(form).getByLabelText("Valor"), "75");
    expect(within(form).getByText(/saldo ficará negativo/)).toBeInTheDocument();

    await userEvent.type(within(form).getByLabelText(/justificativa/i), "Emergência");
    await userEvent.click(within(form).getByRole("button", { name: "Retirar" }));
    expect(spy.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("shows the movement log, including accounts that were deleted", async () => {
    setup();
    renderApp("/movimentacoes");

    const table = await screen.findByRole("table", { name: "Histórico de movimentações" });
    const rows = within(table).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Retirada");
    expect(rows[1]).toHaveTextContent("Saque para a feira");
    expect(rows[1]).toHaveTextContent("R$ 30,00");
    expect(rows[2]).toHaveTextContent("Conta antiga (excluída)");
    expect(rows[2]).toHaveTextContent("Poupança");
  });

  it("filters the log by account and type", async () => {
    const spy = setup();
    renderApp("/movimentacoes?conta=2");

    await screen.findByRole("table", { name: "Histórico de movimentações" });
    expect(screen.getByLabelText("Conta", { selector: "#log-account" })).toHaveValue("2");
    await userEvent.selectOptions(screen.getByLabelText("Tipo"), "deposit");

    const last = [...spy.mock.calls].reverse().find(([u]) => String(u).includes("/movements"));
    const url = new URL(String(last?.[0]), "http://localhost");
    expect(url.searchParams.get("account_id")).toBe("2");
    expect(url.searchParams.get("kind")).toBe("deposit");
  });
});
