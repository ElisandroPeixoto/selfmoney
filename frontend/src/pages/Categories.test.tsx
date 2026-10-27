import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import type { Category } from "../api/client";
import { mockApi, renderApp } from "../test/utils";

const existing: Category[] = [{ id: 1, name: "Moradia", color: "#2a78d6", icon: null }];

describe("Categories page", () => {
  it("adds a category with an icon and the next palette color", async () => {
    const fetchSpy = mockApi({
      "GET /api/categories": () => ({ body: existing }),
      "POST /api/categories": (init) => ({
        status: 201,
        body: { id: 2, ...JSON.parse(String(init?.body)) },
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
    expect(await screen.findByText(/nenhuma categoria cadastrada/i)).toBeInTheDocument();
  });

  it("keeps the category when removal is cancelled", async () => {
    const fetchSpy = mockApi({ "GET /api/categories": () => ({ body: existing }) });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderApp("/categorias");

    await userEvent.click(await screen.findByRole("button", { name: "Remover Moradia" }));
    expect(screen.getByText("Moradia")).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
