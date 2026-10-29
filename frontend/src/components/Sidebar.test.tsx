import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { mockApi, renderApp } from "../test/utils";
import { SIDEBAR_STORAGE_KEY } from "./Sidebar";

describe("Sidebar", () => {
  beforeEach(() => {
    mockApi({
      "GET /api/accounts": () => ({ body: [] }),
      "GET /api/categories": () => ({ body: [] }),
      "GET /api/dashboard/summary": () => ({ status: 500 }),
    });
  });

  it("collapses and expands, remembering the choice", async () => {
    renderApp("/contas");
    const sidebar = screen.getByRole("complementary");
    expect(sidebar).not.toHaveClass("collapsed");

    await userEvent.click(screen.getByRole("button", { name: /recolher barra lateral/i }));
    expect(sidebar).toHaveClass("collapsed");
    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe("true");
    // Links stay reachable by name when only icons are shown.
    expect(screen.getByRole("link", { name: "Categorias" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /expandir barra lateral/i }));
    expect(sidebar).not.toHaveClass("collapsed");
  });

  it("starts collapsed when that was saved", async () => {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, "true");
    renderApp("/contas");
    expect(screen.getByRole("complementary")).toHaveClass("collapsed");
    await screen.findByText(/nenhuma conta cadastrada/i);
  });

  it("lists Dashboard first, then a separator and the rest in alphabetical order", () => {
    renderApp("/contas");
    const nav = screen.getByRole("navigation", { name: "Principal" });
    const items = within(nav).getAllByRole("listitem");

    expect(items[0]).toHaveTextContent("Dashboard");
    expect(items[0].nextElementSibling).toBe(within(nav).getByRole("separator"));
    expect(items.slice(1).map((li) => li.textContent)).toEqual([
      "Cartão de Crédito",
      "Categorias",
      "Contas",
      "Lançamentos",
      "Movimentações",
      "Orçamentos",
      "Relatórios",
    ]);
  });

  it("shows the logo for the current theme above the name", async () => {
    localStorage.setItem("selfmoney.theme", "light");
    const { container } = renderApp("/contas");
    const logo = container.querySelector<HTMLImageElement>(".brand-logo")!;
    expect(logo.src).toContain("logo-light");
    expect(logo.nextElementSibling).toHaveTextContent("SelfMoney");

    await userEvent.click(screen.getByRole("button", { name: /ativar modo escuro/i }));
    expect(logo.src).toContain("logo-dark");
  });

  it("navigates to the categories page", async () => {
    renderApp("/contas");
    await userEvent.click(screen.getByRole("link", { name: /categorias/i }));
    expect(screen.getByRole("heading", { level: 1, name: "Categorias" })).toBeInTheDocument();
  });
});
