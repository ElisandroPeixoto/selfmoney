import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import type { BalanceCheck } from "../api/client";
import { mockApi, renderApp } from "../test/utils";

const older: BalanceCheck = { id: 1, created_at: "2026-10-01T12:00:00+00:00" };

describe("Balance checks page", () => {
  it("shows an empty state and records a balance with one click", async () => {
    let list: BalanceCheck[] = [];
    const spy = mockApi({
      "GET /api/balance-checks": () => ({ body: list }),
      "POST /api/balance-checks": () => {
        const created = { id: 2, created_at: "2026-10-30T18:45:00+00:00" };
        list = [created];
        return { status: 201, body: created };
      },
    });
    renderApp("/balancos");

    expect(await screen.findByText("Nenhum balanço registrado.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Registrar balanço agora" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Balanço registrado em");
    expect(spy.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true);
    const history = screen.getByRole("region", { name: "Histórico" });
    expect(within(history).getAllByRole("listitem")).toHaveLength(1);
  });

  it("lists the history and deletes a record after confirming", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const spy = mockApi({
      "GET /api/balance-checks": () => ({ body: [older] }),
      "DELETE /api/balance-checks/1": () => ({ status: 204 }),
    });
    renderApp("/balancos");

    const history = await screen.findByRole("region", { name: "Histórico" });
    expect(within(history).getAllByRole("listitem")).toHaveLength(1);
    await userEvent.click(within(history).getByRole("button", { name: /Excluir balanço/ }));

    expect(await screen.findByText("Os balanços registrados aparecerão aqui.")).toBeInTheDocument();
    expect(spy.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
  });
});

describe("Balance checks weekday", () => {
  it("shows the day of the week next to the date and time", async () => {
    // Noon UTC keeps the same calendar day in every time zone the tests may run in.
    mockApi({
      "GET /api/balance-checks": () => ({
        body: [{ id: 1, created_at: "2026-10-30T12:00:00+00:00" }],
      }),
    });
    renderApp("/balancos");

    const history = await screen.findByRole("region", { name: "Histórico" });
    expect(within(history).getByRole("listitem")).toHaveTextContent(/sexta-feira/);
  });
});
