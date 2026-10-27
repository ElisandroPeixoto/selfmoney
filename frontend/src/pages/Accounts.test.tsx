import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { vi } from "vitest";

import type { Account } from "../api/client";
import { mockApi, renderApp } from "../test/utils";

const account: Account = {
  id: 7,
  name: "Conta Corrente",
  initial_balance: "100.00",
  balance: "150.00",
  currency: "BRL",
  bank: null,
};

describe("Accounts page", () => {
  it("renames the account and sets bank and currency", async () => {
    const fetchSpy = mockApi({
      "GET /api/accounts": () => ({ body: [account] }),
      "PATCH /api/accounts/7": (init) => ({
        body: { ...account, ...JSON.parse(String(init?.body)) },
      }),
    });
    renderApp("/contas");

    const form = await screen.findByRole("form", { name: /editar conta conta corrente/i });
    const save = within(form).getByRole("button", { name: "Salvar" });
    expect(save).toBeDisabled();

    const name = within(form).getByLabelText("Nome");
    await userEvent.clear(name);
    await userEvent.type(name, "Nubank");
    await userEvent.selectOptions(within(form).getByLabelText("Banco"), "nubank");
    await userEvent.selectOptions(within(form).getByLabelText("Moeda"), "USD");

    // Logo follows the selected bank immediately.
    expect(within(form).getByRole("img", { name: "Nubank" })).toBeInTheDocument();
    expect(within(form).getByText(/não converte/i)).toBeInTheDocument();

    await userEvent.click(save);

    expect(await within(form).findByText("Salvo")).toBeInTheDocument();
    const patch = fetchSpy.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({
      name: "Nubank",
      bank: "nubank",
      currency: "USD",
    });
    expect(within(form).getByText(/^Saldo:/)).toHaveTextContent("Saldo: US$ 150,00");
  });

  it("shows a message when the name is taken", async () => {
    mockApi({
      "GET /api/accounts": () => ({ body: [account] }),
      "PATCH /api/accounts/7": () => ({ status: 409 }),
    });
    renderApp("/contas");

    const form = await screen.findByRole("form", { name: /editar conta/i });
    await userEvent.type(within(form).getByLabelText("Nome"), " 2");
    await userEvent.click(within(form).getByRole("button", { name: "Salvar" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent(/já existe/i);
  });
});

describe("Accounts page: add and remove", () => {
  it("creates a new account", async () => {
    const fetchSpy = mockApi({
      "GET /api/accounts": () => ({ body: [] }),
      "POST /api/accounts": (init) => ({
        status: 201,
        body: { id: 9, ...JSON.parse(String(init?.body)), balance: "250.00" },
      }),
    });
    renderApp("/contas");

    const form = await screen.findByRole("form", { name: "Nova conta" });
    await userEvent.type(within(form).getByLabelText("Nome"), "Itaú PJ");
    const balance = within(form).getByLabelText("Saldo inicial");
    await userEvent.clear(balance);
    await userEvent.type(balance, "250");
    await userEvent.selectOptions(within(form).getByLabelText("Banco"), "itau");
    await userEvent.click(within(form).getByRole("button", { name: "Adicionar conta" }));

    expect(await screen.findByRole("form", { name: /editar conta itaú pj/i })).toBeInTheDocument();
    const post = fetchSpy.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      name: "Itaú PJ",
      initial_balance: "250",
      bank: "itau",
      currency: "BRL",
    });
    expect(within(form).getByLabelText("Nome")).toHaveValue("");
  });

  it("deletes an account after confirmation", async () => {
    mockApi({
      "GET /api/accounts": () => ({ body: [account] }),
      "DELETE /api/accounts/7": () => ({ status: 204 }),
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderApp("/contas");

    await userEvent.click(await screen.findByRole("button", { name: "Excluir Conta Corrente" }));

    expect(confirm.mock.calls[0][0]).toMatch(/lançamentos dela também serão excluídos/);
    expect(await screen.findByText(/nenhuma conta cadastrada/i)).toBeInTheDocument();
  });
});
