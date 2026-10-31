import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import type { Account, CardBill, CardPurchase, Category, CreditCard } from "../api/client";
import { mockApi, renderApp } from "../test/utils";

const account: Account = {
  id: 1,
  name: "Nubank",
  initial_balance: "0",
  balance: "500.00",
  currency: "BRL",
  bank: "nubank",
};

const categories: Category[] = [
  { id: 3, name: "Casa", color: "#2a78d6", icon: null, kind: "expense" },
  { id: 4, name: "Salário", color: "#1baf7a", icon: null, kind: "income" },
];

const card: CreditCard = {
  id: 9,
  name: "Roxinho",
  account_id: 1,
  account_name: "Nubank",
  currency: "BRL",
  due_day: 10,
  pending_total: "1000.00",
};

const sofa: CardPurchase = {
  id: 20,
  card_id: 9,
  description: "Sofá",
  amount: "1000.00",
  installments: 3,
  installment_amount: "333.33",
  date: "2026-10-20",
  first_year: 2026,
  first_month: 11,
  category_id: 3,
  exported_installments: 0,
};

/** A bill; November 2026 holds the sofa's first installment. */
function bill(year: number, month: number, exported = false): CardBill {
  const installments =
    year === 2026 && month === 11
      ? [
          {
            purchase_id: 20,
            description: "Sofá",
            number: 1,
            installments: 3,
            amount: "333.34",
            category_id: 3,
            transaction_id: exported ? 77 : null,
          },
        ]
      : [];
  const total = installments.length ? "333.34" : "0.00";
  return { year, month, total, pending_total: exported ? "0.00" : total, installments };
}

type Spy = ReturnType<typeof mockApi>;

function lastUrl(spy: Spy, path: string): URL | undefined {
  const call = [...spy.mock.calls].reverse().find(([u]) => String(u).includes(path));
  return call ? new URL(String(call[0]), "http://localhost") : undefined;
}

function bodyOf(spy: Spy, method: string, path: string): unknown {
  const call = spy.mock.calls.find(
    ([u, init]) =>
      init?.method === method && new URL(String(u), "http://localhost").pathname === path,
  );
  return call ? JSON.parse(String(call[1]?.body)) : undefined;
}

const lookups = {
  "GET /api/accounts": () => ({ body: [account] }),
  "GET /api/categories": () => ({ body: categories }),
};

describe("Credit card page", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 25) });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates the first card linked to an account", async () => {
    const created = { ...card, pending_total: "0.00" };
    const spy = mockApi({
      ...lookups,
      "GET /api/cards": () => ({ body: [] }),
      "POST /api/cards": () => ({ status: 201, body: created }),
      "GET /api/cards/9/bills": () => ({ body: [bill(2026, 10)] }),
      "GET /api/cards/9/purchases": () => ({ body: [] }),
    });
    renderApp("/cartoes");

    const form = await screen.findByRole("form", { name: "Novo cartão" });
    await userEvent.type(within(form).getByLabelText("Nome do cartão"), "Roxinho");
    expect(within(form).getByLabelText("Conta vinculada")).toHaveValue("1");
    // The account sets the currency, so there is nothing to pick.
    expect(within(form).queryByLabelText("Moeda")).not.toBeInTheDocument();
    await userEvent.type(within(form).getByLabelText("Dia do vencimento"), "10");
    await userEvent.click(within(form).getByRole("button", { name: "Adicionar cartão" }));

    expect(bodyOf(spy, "POST", "/api/cards")).toEqual({
      name: "Roxinho",
      account_id: 1,
      currency: "BRL",
      due_day: 10,
    });
    expect(await screen.findByRole("heading", { name: "Roxinho" })).toBeInTheDocument();
  });

  it("has no automatic export option and asks for a currency without an account", async () => {
    mockApi({ ...lookups, "GET /api/cards": () => ({ body: [] }) });
    renderApp("/cartoes");

    const form = await screen.findByRole("form", { name: "Novo cartão" });
    expect(within(form).queryByLabelText(/exportar automaticamente/i)).not.toBeInTheDocument();
    await userEvent.selectOptions(within(form).getByLabelText("Conta vinculada"), "");
    expect(within(form).getByLabelText("Moeda")).toBeInTheDocument();
  });

  it("adds a purchase in installments", async () => {
    const spy = mockApi({
      ...lookups,
      "GET /api/cards": () => ({ body: [card] }),
      "GET /api/cards/9/bills": () => ({ body: [bill(2026, 10)] }),
      "GET /api/cards/9/purchases": () => ({ body: [] }),
      "POST /api/cards/9/purchases": () => ({ status: 201, body: sofa }),
    });
    renderApp("/cartoes");

    const form = await screen.findByRole("form", { name: "Nova compra" });
    // Only expense categories apply to card purchases.
    const category = within(form).getByLabelText("Categoria");
    expect(within(category).queryByRole("option", { name: "Salário" })).not.toBeInTheDocument();

    await userEvent.type(within(form).getByLabelText("Descrição"), "Sofá");
    await userEvent.type(within(form).getByLabelText("Valor total"), "100000");
    const count = within(form).getByLabelText("Parcelas");
    await userEvent.clear(count);
    await userEvent.type(count, "3");
    expect(within(form).getByTestId("purchase-split")).toHaveTextContent(
      "3x de R$ 333,33 (a 1ª de R$ 333,34)",
    );
    // The first installment defaults to the bill after the purchase.
    expect(within(form).getByLabelText("1ª parcela na fatura de")).toHaveValue("2026-11");
    await userEvent.selectOptions(category, "3");
    await userEvent.click(within(form).getByRole("button", { name: "Adicionar compra" }));

    expect(bodyOf(spy, "POST", "/api/cards/9/purchases")).toEqual({
      description: "Sofá",
      amount: "1000.00",
      installments: 3,
      date: "2026-10-25",
      first_year: 2026,
      first_month: 11,
      category_id: 3,
    });
    expect(await within(form).findByLabelText("Descrição")).toHaveValue("");
    // Lists and bills reload after the purchase.
    const purchaseLoads = spy.mock.calls.filter(
      ([u, init]) => !init?.method && String(u).endsWith("/api/cards/9/purchases"),
    );
    expect(purchaseLoads.length).toBeGreaterThan(1);
  });

  it("shows the month's bill and exports it to the transactions", async () => {
    let exported = false;
    const spy = mockApi({
      ...lookups,
      "GET /api/cards": () => ({
        body: [{ ...card, pending_total: exported ? "666.66" : "1000.00" }],
      }),
      "GET /api/cards/9/bills": () => ({ body: [bill(2026, 11, exported)] }),
      "GET /api/cards/9/purchases": () => ({ body: [sofa] }),
      "POST /api/cards/9/bills/2026/11/export": () => {
        exported = true;
        return { body: { created: 1, bill: bill(2026, 11, true) } };
      },
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderApp("/cartoes");

    await screen.findByRole("heading", { name: "Fatura de Outubro de 2026" });
    await userEvent.click(screen.getByRole("button", { name: /próximo mês/i }));
    expect(screen.getByRole("heading", { name: "Fatura de Novembro de 2026" })).toBeInTheDocument();
    expect(lastUrl(spy, "/bills")?.searchParams.get("month")).toBe("11");

    const section = screen.getByRole("region", { name: "Fatura de Novembro de 2026" });
    expect(await within(section).findByText("1/3")).toBeInTheDocument();
    expect(within(section).getByText("○ Pendente")).toBeInTheDocument();
    expect(within(section).getByText("Casa")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Exportar para Lançamentos" }));
    expect(confirm.mock.calls[0][0]).toMatch(/1 parcela\(s\) da fatura de Novembro de 2026/);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "1 lançamento(s) criado(s) na conta Nubank.",
    );
    expect(await within(section).findByText("✓ Lançada")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exportar para Lançamentos" })).toBeDisabled();
    // The card's pending total is fetched again.
    expect(await screen.findByText("R$ 666,66")).toBeInTheDocument();
  });

  it("needs a linked account to export", async () => {
    const loose = { ...card, account_id: null, account_name: null };
    mockApi({
      ...lookups,
      "GET /api/cards": () => ({ body: [loose] }),
      "GET /api/cards/9/bills": () => ({ body: [bill(2026, 11)] }),
      "GET /api/cards/9/purchases": () => ({ body: [sofa] }),
    });
    renderApp("/cartoes");

    expect(
      await screen.findByText("Vincule o cartão a uma conta para exportar."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exportar para Lançamentos" })).toBeDisabled();
  });

  it("deletes a purchase after confirmation", async () => {
    let purchases = [{ ...sofa, exported_installments: 1 }];
    const spy = mockApi({
      ...lookups,
      "GET /api/cards": () => ({ body: [card] }),
      "GET /api/cards/9/bills": () => ({ body: [bill(2026, 10)] }),
      "GET /api/cards/9/purchases": () => ({ body: purchases }),
      "DELETE /api/cards/9/purchases/20": () => {
        purchases = [];
        return { status: 204 };
      },
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderApp("/cartoes");

    const row = (await screen.findByText("3x de R$ 333,33")).closest("tr") as HTMLElement;
    expect(within(row).getByText("1 de 3")).toBeInTheDocument();
    await userEvent.click(within(row).getByRole("button", { name: "Excluir Sofá" }));

    expect(confirm.mock.calls[0][0]).toMatch(/já exportadas continuam em Lançamentos/);
    expect(await screen.findByText("Nenhuma compra neste cartão.")).toBeInTheDocument();
    expect(spy.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
  });

  it("edits a purchase, including its category", async () => {
    let current = sofa;
    const spy = mockApi({
      ...lookups,
      "GET /api/cards": () => ({ body: [card] }),
      "GET /api/cards/9/bills": () => ({ body: [bill(2026, 10)] }),
      "GET /api/cards/9/purchases": () => ({ body: [current] }),
      "PATCH /api/cards/9/purchases/20": (init) => {
        current = { ...current, ...JSON.parse(String(init?.body)) };
        return { body: current };
      },
    });
    renderApp("/cartoes");

    await userEvent.click(await screen.findByRole("button", { name: "Editar Sofá" }));
    const form = screen.getByRole("form", { name: "Editar compra Sofá" });
    const description = within(form).getByLabelText("Descrição");
    expect(description).toHaveValue("Sofá");
    expect(within(form).getByLabelText("1ª parcela na fatura de")).toHaveValue("2026-11");
    await userEvent.clear(description);
    await userEvent.type(description, "Sofá cama");
    await userEvent.selectOptions(within(form).getByLabelText("Categoria"), "");
    await userEvent.click(within(form).getByRole("button", { name: "Salvar compra" }));

    expect(bodyOf(spy, "PATCH", "/api/cards/9/purchases/20")).toEqual({
      description: "Sofá cama",
      amount: "1000.00",
      installments: 3,
      date: "2026-10-20",
      first_year: 2026,
      first_month: 11,
      category_id: null,
    });
    expect(await screen.findByText("Sofá cama")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: /Editar compra/ })).not.toBeInTheDocument();
  });

  it("locks amount and dates of a purchase that already has exported installments", async () => {
    mockApi({
      ...lookups,
      "GET /api/cards": () => ({ body: [card] }),
      "GET /api/cards/9/bills": () => ({ body: [bill(2026, 10)] }),
      "GET /api/cards/9/purchases": () => ({ body: [{ ...sofa, exported_installments: 1 }] }),
    });
    renderApp("/cartoes");

    await userEvent.click(await screen.findByRole("button", { name: "Editar Sofá" }));
    const form = screen.getByRole("form", { name: "Editar compra Sofá" });
    expect(within(form).getByLabelText("Valor total")).toBeDisabled();
    expect(within(form).getByLabelText("Parcelas")).toBeDisabled();
    expect(within(form).getByLabelText("Data da compra")).toBeDisabled();
    expect(within(form).getByLabelText("Descrição")).toBeEnabled();
    expect(within(form).getByLabelText("Categoria")).toBeEnabled();
    expect(within(form).getByText(/já tem parcelas em Lançamentos/)).toBeInTheDocument();
  });

  it("sends a single purchase to the transactions", async () => {
    const spy = mockApi({
      ...lookups,
      "GET /api/cards": () => ({ body: [card] }),
      "GET /api/cards/9/bills": () => ({ body: [bill(2026, 10)] }),
      "GET /api/cards/9/purchases": () => ({ body: [sofa] }),
      "POST /api/cards/9/purchases/export": () => ({
        body: { created: 3, purchases: [{ ...sofa, exported_installments: 3 }] },
      }),
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderApp("/cartoes");

    await userEvent.click(
      await screen.findByRole("button", { name: "Enviar Sofá para Lançamentos" }),
    );

    expect(confirm.mock.calls[0][0]).toMatch(/3 parcela\(s\) de a compra "Sofá"/);
    expect(bodyOf(spy, "POST", "/api/cards/9/purchases/export")).toEqual({ purchase_ids: [20] });
    const purchases = screen.getByRole("region", { name: "Compras" });
    expect(await within(purchases).findByRole("status")).toHaveTextContent(
      "3 lançamento(s) criado(s) na conta Nubank.",
    );
  });

  it("sends only the ticked purchases and skips the ones already sent", async () => {
    const mesa: CardPurchase = { ...sofa, id: 21, description: "Mesa", installments: 1 };
    const sent: CardPurchase = { ...sofa, id: 22, description: "Geladeira", exported_installments: 3 };
    const spy = mockApi({
      ...lookups,
      "GET /api/cards": () => ({ body: [card] }),
      "GET /api/cards/9/bills": () => ({ body: [bill(2026, 10)] }),
      "GET /api/cards/9/purchases": () => ({ body: [sofa, mesa, sent] }),
      "POST /api/cards/9/purchases/export": () => ({
        body: { created: 4, purchases: [sofa, mesa] },
      }),
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderApp("/cartoes");

    const send = await screen.findByRole("button", { name: /Enviar selecionadas/ });
    expect(send).toBeDisabled();
    // Fully sent purchases can't be ticked.
    expect(screen.getByLabelText("Selecionar Geladeira")).toBeDisabled();

    await userEvent.click(screen.getByLabelText("Selecionar Sofá"));
    await userEvent.click(screen.getByLabelText("Selecionar Mesa"));
    expect(send).toHaveTextContent("(2)");
    await userEvent.click(send);

    expect(bodyOf(spy, "POST", "/api/cards/9/purchases/export")).toEqual({
      purchase_ids: [20, 21],
    });
    expect(await screen.findByText("4 lançamento(s) criado(s) na conta Nubank.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Enviar selecionadas/ })).toBeDisabled();
  });

  it("selects every pending purchase at once and needs an account to send", async () => {
    const loose = { ...card, account_id: null, account_name: null };
    mockApi({
      ...lookups,
      "GET /api/cards": () => ({ body: [loose] }),
      "GET /api/cards/9/bills": () => ({ body: [bill(2026, 10)] }),
      "GET /api/cards/9/purchases": () => ({ body: [sofa] }),
    });
    renderApp("/cartoes");

    await userEvent.click(
      await screen.findByLabelText("Selecionar todas as compras pendentes"),
    );
    expect(screen.getByLabelText("Selecionar Sofá")).toBeChecked();
    expect(screen.getByRole("button", { name: /Enviar selecionadas/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Enviar Sofá para Lançamentos" })).toBeDisabled();
    expect(screen.getAllByText("Vincule o cartão a uma conta para enviar.").length).toBe(1);
  });

  it("links an account to a card and switches between cards", async () => {
    const other: CreditCard = {
      ...card,
      id: 10,
      name: "Azul",
      account_id: null,
      account_name: null,
    };
    const spy = mockApi({
      ...lookups,
      "GET /api/cards": () => ({ body: [other, card] }),
      "GET /api/cards/10/bills": () => ({ body: [bill(2026, 10)] }),
      "GET /api/cards/10/purchases": () => ({ body: [] }),
      "GET /api/cards/9/bills": () => ({ body: [bill(2026, 10)] }),
      "GET /api/cards/9/purchases": () => ({ body: [] }),
      "PATCH /api/cards/10": () => ({
        body: { ...other, account_id: 1, account_name: "Nubank" },
      }),
    });
    renderApp("/cartoes");

    expect(await screen.findByRole("heading", { name: "Azul" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Editar Azul" }));
    const form = screen.getByRole("form", { name: "Editar cartão Azul" });
    await userEvent.selectOptions(within(form).getByLabelText("Conta vinculada"), "1");
    await userEvent.click(within(form).getByRole("button", { name: "Salvar cartão" }));

    expect(bodyOf(spy, "PATCH", "/api/cards/10")).toMatchObject({ account_id: 1 });
    const facts = await screen.findByText("Conta vinculada", { selector: "dt" });
    expect(facts.nextElementSibling).toHaveTextContent("Nubank");

    await userEvent.selectOptions(screen.getByLabelText("Cartão"), "9");
    expect(await screen.findByRole("heading", { name: "Roxinho" })).toBeInTheDocument();
  });
});
