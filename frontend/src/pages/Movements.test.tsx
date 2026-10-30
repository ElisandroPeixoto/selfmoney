import { fireEvent, screen, within } from "@testing-library/react";
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
  {
    id: 2,
    name: "Poupança",
    initial_balance: "0",
    balance: "50.00",
    currency: "BRL",
    bank: null,
  },
  {
    id: 3,
    name: "Wise",
    initial_balance: "0",
    balance: "10.00",
    currency: "USD",
    bank: null,
  },
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

    await userEvent.type(within(form).getByLabelText("Valor"), "25000");
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
      amount: "250.00",
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
    await userEvent.type(within(form).getByLabelText("Valor"), "8000");
    await userEvent.type(within(form).getByLabelText(/justificativa/i), "Reembolso do almoço");
    await userEvent.click(within(form).getByRole("button", { name: "Adicionar" }));

    const post = spy.mock.calls.find(([, init]) => init?.method === "POST");
    expect(body(post?.[1])).toEqual({
      amount: "80.00",
      reason: "Reembolso do almoço",
      account_id: 2,
    });
  });

  it("warns when a withdrawal leaves the balance negative and does nothing if cancelled", async () => {
    const spy = setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderApp("/movimentacoes?tipo=withdrawal");

    const form = await screen.findByRole("form", { name: "Retirar dinheiro" });
    await userEvent.selectOptions(within(form).getByLabelText("Conta"), "2");
    await userEvent.type(within(form).getByLabelText("Valor"), "7500");
    expect(within(form).getByText(/saldo ficará negativo/)).toBeInTheDocument();

    await userEvent.type(within(form).getByLabelText(/justificativa/i), "Emergência");
    await userEvent.click(within(form).getByRole("button", { name: "Retirar" }));
    expect(spy.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("shows the movement log, including accounts that were deleted", async () => {
    setup();
    renderApp("/movimentacoes");

    const table = await screen.findByRole("table", {
      name: "Histórico de movimentações",
    });
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

  function lastLogUrl(spy: ReturnType<typeof setup>): URL {
    const last = [...spy.mock.calls].reverse().find(([u]) => String(u).includes("/movements"));
    return new URL(String(last?.[0]), "http://localhost");
  }

  it("filters the log by a range of local days", async () => {
    const spy = setup();
    renderApp("/movimentacoes");
    await screen.findByRole("table", { name: "Histórico de movimentações" });
    expect(screen.queryByRole("button", { name: "Limpar datas" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Data inicial"), {
      target: { value: "2026-10-01" },
    });
    fireEvent.change(screen.getByLabelText("Data final"), {
      target: { value: "2026-10-15" },
    });

    // Whole local days: from the start of the first to the start of the day after the last.
    const url = lastLogUrl(spy);
    expect(url.searchParams.get("created_from")).toBe(new Date(2026, 9, 1).toISOString());
    expect(url.searchParams.get("created_before")).toBe(new Date(2026, 9, 16).toISOString());
    expect(screen.getByLabelText("Data inicial")).toHaveAttribute("max", "2026-10-15");
    expect(screen.getByLabelText("Data final")).toHaveAttribute("min", "2026-10-01");

    await userEvent.click(screen.getByRole("button", { name: "Limpar datas" }));
    expect(screen.getByLabelText("Data inicial")).toHaveValue("");
    expect(lastLogUrl(spy).searchParams.has("created_from")).toBe(false);
  });

  it("keeps the dates in the address and says when the period is empty", async () => {
    const spy = setup({ "GET /api/movements": () => ({ body: [] }) });
    renderApp("/movimentacoes?de=2026-04-01");

    expect(await screen.findByText("Nenhuma movimentação neste período.")).toBeInTheDocument();
    expect(screen.getByLabelText("Data inicial")).toHaveValue("2026-04-01");
    expect(lastLogUrl(spy).searchParams.has("created_before")).toBe(false);
  });

  it("rejects a start date after the end date", async () => {
    const spy = setup();
    renderApp("/movimentacoes?de=2026-05-01&ate=2026-04-01");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A data inicial precisa ser anterior ou igual à data final.",
    );
    expect(spy.mock.calls.some(([u]) => String(u).includes("/movements"))).toBe(false);
  });

  it("deletes a movement after confirmation and reloads balances and log", async () => {
    let current = log;
    const spy = setup({
      "GET /api/movements": () => ({ body: current }),
      "DELETE /api/movements/2": () => {
        current = log.filter((m) => m.id !== 2);
        return { status: 204 };
      },
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderApp("/movimentacoes");

    const table = await screen.findByRole("table", { name: "Histórico de movimentações" });
    await userEvent.click(
      within(table).getByRole("button", { name: "Excluir retirada: Saque para a feira" }),
    );

    expect(confirm.mock.calls[0][0]).toMatch(
      /Excluir a retirada de R\$\s30,00 \(Saque para a feira\)/,
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Retirada de R$ 30,00 excluída do histórico.",
    );
    expect(screen.queryByText("Saque para a feira")).not.toBeInTheDocument();
    const accountLoads = spy.mock.calls.filter(([u]) => String(u).endsWith("/api/accounts"));
    expect(accountLoads.length).toBe(2);
  });

  it("keeps the movement when the deletion is not confirmed", async () => {
    const spy = setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderApp("/movimentacoes");

    const table = await screen.findByRole("table", { name: "Histórico de movimentações" });
    await userEvent.click(
      within(table).getByRole("button", { name: "Excluir transferência: Fechando a conta antiga" }),
    );
    expect(spy.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    expect(within(table).getByText("Fechando a conta antiga")).toBeInTheDocument();
  });

  it("tells when a movement can't be deleted", async () => {
    setup({ "DELETE /api/movements/2": () => ({ status: 500 }) });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderApp("/movimentacoes");

    const table = await screen.findByRole("table", { name: "Histórico de movimentações" });
    await userEvent.click(
      within(table).getByRole("button", { name: "Excluir retirada: Saque para a feira" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível excluir a movimentação.",
    );
    expect(within(table).getByText("Saque para a feira")).toBeInTheDocument();
  });

  function patchBody(spy: ReturnType<typeof setup>): unknown {
    const call = spy.mock.calls.find(([, init]) => init?.method === "PATCH");
    return call ? JSON.parse(String(call[1]?.body)) : undefined;
  }

  it("edits the amount and justification of a movement", async () => {
    const spy = setup({
      "PATCH /api/movements/2": (init) => ({
        body: { ...log[0], ...JSON.parse(String(init?.body)) },
      }),
    });
    renderApp("/movimentacoes");

    const table = await screen.findByRole("table", { name: "Histórico de movimentações" });
    await userEvent.click(
      within(table).getByRole("button", { name: "Editar retirada: Saque para a feira" }),
    );
    const form = screen.getByRole("form", { name: "Editar retirada" });
    const save = within(form).getByRole("button", { name: "Salvar alterações" });
    expect(save).toBeDisabled();
    // A withdrawal only has the account the money left.
    expect(within(form).getByLabelText("Conta")).toHaveValue("1");
    expect(within(form).queryByLabelText("Para")).not.toBeInTheDocument();

    const amount = within(form).getByLabelText("Valor");
    await userEvent.clear(amount);
    await userEvent.type(amount, "4500");
    const reason = within(form).getByLabelText(/justificativa/i);
    await userEvent.clear(reason);
    await userEvent.type(reason, "Saque maior");
    await userEvent.click(save);

    expect(patchBody(spy)).toEqual({ amount: "45.00", reason: "Saque maior" });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Retirada atualizada no histórico.",
    );
    expect(screen.queryByRole("form", { name: "Editar retirada" })).not.toBeInTheDocument();
  });

  it("changes the destination of a transfer whose source was deleted", async () => {
    const spy = setup({
      "PATCH /api/movements/1": () => ({ body: { ...log[1], to_account_id: 1 } }),
    });
    renderApp("/movimentacoes");

    const table = await screen.findByRole("table", { name: "Histórico de movimentações" });
    await userEvent.click(
      within(table).getByRole("button", {
        name: "Editar transferência: Fechando a conta antiga",
      }),
    );
    const form = screen.getByRole("form", { name: "Editar transferência" });
    expect(within(form).getByLabelText("De")).toHaveDisplayValue("Conta antiga (excluída)");
    // Only accounts in the transfer's currency can receive it.
    const to = within(form).getByLabelText("Para");
    expect(within(to).queryByRole("option", { name: "Wise" })).not.toBeInTheDocument();

    await userEvent.selectOptions(to, "1");
    await userEvent.click(within(form).getByRole("button", { name: "Salvar alterações" }));
    expect(patchBody(spy)).toEqual({ to_account_id: 1 });
  });

  it("closes the editor without saving on cancel", async () => {
    const spy = setup();
    renderApp("/movimentacoes");

    const table = await screen.findByRole("table", { name: "Histórico de movimentações" });
    await userEvent.click(
      within(table).getByRole("button", { name: "Editar retirada: Saque para a feira" }),
    );
    const form = screen.getByRole("form", { name: "Editar retirada" });
    await userEvent.click(within(form).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("form", { name: "Editar retirada" })).not.toBeInTheDocument();
    expect(spy.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  });
});
