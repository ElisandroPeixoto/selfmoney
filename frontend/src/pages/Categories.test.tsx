import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import type { Category } from "../api/client";
import { mockApi, renderApp } from "../test/utils";

const existing: Category[] = [
  { id: 1, name: "Moradia", color: "#2a78d6", icon: null, kind: "expense" },
  { id: 2, name: "Salário", color: "#008300", icon: null, kind: "income" },
];

describe("Categories page", () => {
  it("adds a category with an icon and the next palette color", async () => {
    const fetchSpy = mockApi({
      "GET /api/categories": () => ({ body: existing }),
      "POST /api/categories": (init) => ({
        status: 201,
        body: { id: 3, ...JSON.parse(String(init?.body)) },
      }),
    });
    renderApp("/categorias");

    await screen.findByText("Moradia");
    await userEvent.click(screen.getByRole("button", { name: "Escolher ícone da nova categoria" }));
    await userEvent.click(screen.getByRole("button", { name: "Educação" }));
    await userEvent.type(screen.getByLabelText("Nome"), "Educação");
    await userEvent.click(screen.getByRole("button", { name: "Adicionar" }));

    expect(await screen.findByText("Educação")).toBeInTheDocument();
    const post = fetchSpy.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      name: "Educação",
      color: "#eb6834",
      icon: "🎓",
      kind: "expense",
    });
    expect(screen.getByLabelText("Nome")).toHaveValue("");
  });

  it("changes the icon of an existing category", async () => {
    const fetchSpy = mockApi({
      "GET /api/categories": () => ({ body: existing }),
      "PATCH /api/categories/1": (init) => ({
        body: { ...existing[0], ...JSON.parse(String(init?.body)) },
      }),
    });
    renderApp("/categorias");

    const trigger = await screen.findByRole("button", { name: "Alterar ícone de Moradia" });
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole("button", { name: "Casa" }));

    expect(trigger).toHaveTextContent("🏠");
    const patch = fetchSpy.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ icon: "🏠" });
    // The picker closes after choosing.
    expect(screen.queryByRole("group", { name: "Ícones" })).not.toBeInTheDocument();
  });

  it("shows a message for duplicate names", async () => {
    mockApi({
      "GET /api/categories": () => ({ body: existing }),
      "POST /api/categories": () => ({ status: 409 }),
    });
    renderApp("/categorias");

    await screen.findByText("Moradia");
    await userEvent.type(screen.getByLabelText("Nome"), "Moradia");
    await userEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/já existe/i);
  });

  it("removes a category after confirmation", async () => {
    mockApi({
      "GET /api/categories": () => ({ body: existing }),
      "DELETE /api/categories/1": () => ({ status: 204 }),
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderApp("/categorias");

    await userEvent.click(await screen.findByRole("button", { name: "Remover Moradia" }));

    expect(confirm).toHaveBeenCalled();
    expect(await screen.findByText(/nenhuma categoria de despesas/i)).toBeInTheDocument();
  });

  it("keeps the category when removal is cancelled", async () => {
    const fetchSpy = mockApi({ "GET /api/categories": () => ({ body: existing }) });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderApp("/categorias");

    await userEvent.click(await screen.findByRole("button", { name: "Remover Moradia" }));
    expect(screen.getByText("Moradia")).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("lists expense and income categories in separate tabs", async () => {
    mockApi({ "GET /api/categories": () => ({ body: existing }) });
    renderApp("/categorias");

    const list = await screen.findByRole("region", { name: "Categorias de despesas" });
    expect(within(list).getByText("Moradia")).toBeInTheDocument();
    expect(within(list).queryByText("Salário")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Receitas" }));
    const income = screen.getByRole("region", { name: "Categorias de receitas" });
    expect(within(income).getByText("Salário")).toBeInTheDocument();
    expect(within(income).queryByText("Moradia")).not.toBeInTheDocument();
  });

  it("creates an income category from the income tab", async () => {
    const fetchSpy = mockApi({
      "GET /api/categories": () => ({ body: existing }),
      "POST /api/categories": (init) => ({
        status: 201,
        body: { id: 3, icon: null, ...JSON.parse(String(init?.body)) },
      }),
    });
    renderApp("/categorias?tipo=receitas");

    await screen.findByText("Salário");
    await userEvent.type(screen.getByLabelText("Nome"), "Freelas");
    await userEvent.click(screen.getByRole("button", { name: "Adicionar" }));

    const post = fetchSpy.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({ name: "Freelas", kind: "income" });
    const income = screen.getByRole("region", { name: "Categorias de receitas" });
    expect(await within(income).findByText("Freelas")).toBeInTheDocument();
  });

  it("changes the color of an existing category", async () => {
    const fetchSpy = mockApi({
      "GET /api/categories": () => ({ body: existing }),
      "PATCH /api/categories/1": (init) => ({
        body: { ...existing[0], ...JSON.parse(String(init?.body)) },
      }),
    });
    renderApp("/categorias");

    const swatch = await screen.findByLabelText("Cor de Moradia");
    // Several quick changes (dragging in the picker) produce a single save.
    fireEvent.input(swatch, { target: { value: "#111111" } });
    fireEvent.input(swatch, { target: { value: "#e34948" } });
    expect(swatch).toHaveValue("#e34948");

    await waitFor(() =>
      expect(fetchSpy.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1),
    );
    const patch = fetchSpy.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ color: "#e34948" });
  });

  it("moves a category to the other list", async () => {
    mockApi({
      "GET /api/categories": () => ({ body: existing }),
      "PATCH /api/categories/1": (init) => ({
        body: { ...existing[0], ...JSON.parse(String(init?.body)) },
      }),
    });
    renderApp("/categorias");

    await userEvent.click(await screen.findByRole("button", { name: "Mover para receitas" }));
    expect(await screen.findByText(/nenhuma categoria de despesas/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Receitas" }));
    expect(screen.getByText("Moradia")).toBeInTheDocument();
  });

  it("explains when a used category can't change lists", async () => {
    mockApi({
      "GET /api/categories": () => ({ body: existing }),
      "PATCH /api/categories/1": () => ({ status: 409 }),
    });
    renderApp("/categorias");

    await userEvent.click(await screen.findByRole("button", { name: "Mover para receitas" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/já tem lançamentos/);
  });
});
