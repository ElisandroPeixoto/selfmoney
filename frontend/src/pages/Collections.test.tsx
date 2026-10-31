import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import type { SpendingCollection } from "../api/client";
import { mockApi, renderApp } from "../test/utils";

function body(init: RequestInit | undefined) {
  return JSON.parse(String(init?.body));
}

const subscriptions: SpendingCollection = {
  id: 1,
  name: "Assinaturas",
  currency: "BRL",
  total: "55.90",
  items: [{ id: 10, name: "Netflix", amount: "55.90" }],
};

describe("Collections page", () => {
  it("shows the items and their total", async () => {
    mockApi({ "GET /api/spending-collections": () => ({ body: [subscriptions] }) });
    renderApp("/colecoes");

    const detail = await screen.findByRole("region", { name: "Assinaturas" });
    expect(within(detail).getByText("Netflix")).toBeInTheDocument();
    expect(detail.querySelector(".collection-total")).toHaveTextContent("R$ 55,90");
  });

  it("adds and removes items, updating the total", async () => {
    let current = subscriptions;
    const spy = mockApi({
      "GET /api/spending-collections": () => ({ body: [current] }),
      "POST /api/spending-collections/1/items": (init) => {
        const payload = body(init);
        current = {
          ...current,
          total: "77.80",
          items: [...current.items, { id: 11, name: payload.name, amount: payload.amount }],
        };
        return { status: 201, body: current };
      },
      "DELETE /api/spending-collections/1/items/10": () => {
        current = { ...current, total: "21.90", items: current.items.filter((i) => i.id !== 10) };
        return { body: current };
      },
    });
    renderApp("/colecoes");

    await userEvent.type(await screen.findByLabelText("Novo item"), "Spotify");
    await userEvent.type(screen.getByLabelText("Valor"), "2190");
    await userEvent.click(screen.getByRole("button", { name: "Adicionar" }));

    const detail = screen.getByRole("region", { name: "Assinaturas" });
    expect(await within(detail).findByText("Spotify")).toBeInTheDocument();
    expect(detail.querySelector(".collection-total")).toHaveTextContent("R$ 77,80");
    const post = spy.mock.calls.find(([, init]) => init?.method === "POST");
    expect(body(post?.[1])).toEqual({ name: "Spotify", amount: "21.90" });

    await userEvent.click(within(detail).getByRole("button", { name: "Remover Netflix" }));
    expect(await within(detail).findByText("R$ 21,90", { selector: "strong" })).toBeInTheDocument();
    expect(within(detail).queryByText("Netflix")).not.toBeInTheDocument();
  });

  it("creates a collection and reports a duplicate name", async () => {
    let first = true;
    mockApi({
      "GET /api/spending-collections": () => ({ body: [] }),
      "POST /api/spending-collections": (init) => {
        if (!first) return { status: 409 };
        first = false;
        return {
          status: 201,
          body: { id: 2, name: body(init).name, currency: "BRL", total: "0.00", items: [] },
        };
      },
    });
    renderApp("/colecoes");

    const form = await screen.findByRole("form", { name: "Nova coleção" });
    await userEvent.type(within(form).getByLabelText("Nome da coleção"), "Seguros");
    await userEvent.click(within(form).getByRole("button", { name: "Criar coleção" }));
    expect(await screen.findByRole("region", { name: "Seguros" })).toBeInTheDocument();

    await userEvent.type(within(form).getByLabelText("Nome da coleção"), "Seguros");
    await userEvent.click(within(form).getByRole("button", { name: "Criar coleção" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Já existe uma coleção/);
  });

  it("deletes a collection after confirming", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mockApi({
      "GET /api/spending-collections": () => ({ body: [subscriptions] }),
      "DELETE /api/spending-collections/1": () => ({ status: 204 }),
    });
    renderApp("/colecoes");

    await userEvent.click(await screen.findByRole("button", { name: "Excluir coleção Assinaturas" }));
    expect(await screen.findByText(/Nenhuma coleção ainda/)).toBeInTheDocument();
  });
});
