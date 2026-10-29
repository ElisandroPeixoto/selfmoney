import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import type { Account } from "../api/client";
import { TOKEN_STORAGE_KEY } from "../auth/session";
import { mockApi, renderApp } from "../test/utils";

const LOCKED = { auth_required: true, authenticated: false };
const UNLOCKED = { auth_required: true, authenticated: true };

const account: Account = {
  id: 1,
  name: "Nubank",
  initial_balance: "0",
  balance: "10.00",
  currency: "BRL",
  bank: "nubank",
};

function authHeader(init: RequestInit | undefined): string | undefined {
  return (init?.headers as Record<string, string> | undefined)?.Authorization;
}

describe("Login", () => {
  it("asks for the password before showing anything", () => {
    const spy = mockApi({});
    renderApp("/contas", LOCKED);

    expect(screen.getByRole("heading", { name: "SelfMoney" })).toBeInTheDocument();
    expect(screen.getByLabelText("Senha")).toHaveFocus();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it("enters with the right password and sends the token from then on", async () => {
    const spy = mockApi({
      "POST /api/auth/login": (init) =>
        JSON.parse(String(init?.body)).password === "segredo"
          ? { body: { token: "tok123", expires_at: "2026-12-01T00:00:00Z" } }
          : { status: 401 },
      "GET /api/accounts": () => ({ body: [account] }),
    });
    renderApp("/contas", LOCKED);

    await userEvent.type(screen.getByLabelText("Senha"), "errada");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Senha incorreta.");
    expect(screen.getByLabelText("Senha")).toHaveValue("");

    await userEvent.type(screen.getByLabelText("Senha"), "segredo");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));

    expect(await screen.findByRole("heading", { name: "Contas", level: 1 })).toBeInTheDocument();
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBe("tok123");
    const accountsCall = spy.mock.calls.find(([u]) => String(u).endsWith("/api/accounts"));
    expect(authHeader(accountsCall?.[1])).toBe("Bearer tok123");
  });

  it("logs out from the sidebar", async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, "tok123");
    mockApi({ "GET /api/accounts": () => ({ body: [account] }) });
    renderApp("/contas", UNLOCKED);

    await userEvent.click(await screen.findByRole("button", { name: "Sair" }));
    expect(screen.getByLabelText("Senha")).toBeInTheDocument();
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    // Leaving on purpose is not an expired session.
    expect(screen.queryByText(/sua sessão terminou/i)).not.toBeInTheDocument();
  });

  it("goes back to the login when the session expires", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.setItem(TOKEN_STORAGE_KEY, "old");
    mockApi({
      "GET /api/budgets": () => ({ status: 401 }),
      "GET /api/dashboard/summary": () => ({ status: 401 }),
      "GET /api/reports/monthly": () => ({ status: 401 }),
    });
    renderApp("/", UNLOCKED);

    expect(await screen.findByText("Sua sessão terminou. Entre novamente.")).toBeInTheDocument();
    expect(screen.getByLabelText("Senha")).toBeInTheDocument();
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("has no logout button when the server has no password", async () => {
    mockApi({ "GET /api/accounts": () => ({ body: [] }) });
    renderApp("/contas");
    await screen.findByRole("heading", { name: "Contas", level: 1 });
    expect(screen.queryByRole("button", { name: "Sair" })).not.toBeInTheDocument();
  });
});
