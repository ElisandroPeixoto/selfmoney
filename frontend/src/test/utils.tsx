import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";

import App from "../App";
import { ThemeProvider } from "../theme/ThemeProvider";

type Handler = (init: RequestInit | undefined) => { status?: number; body?: unknown };

/** Mocks fetch with handlers keyed by "METHOD /path" (query string ignored). */
export function mockApi(routes: Record<string, Handler>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input), "http://localhost");
    const key = `${init?.method ?? "GET"} ${url.pathname}`;
    const handler = routes[key];
    if (!handler) throw new Error(`Unexpected request: ${key}`);
    const { status = 200, body } = handler(init);
    return {
      ok: status < 400,
      status,
      json: async () => body,
    } as Response;
  });
}

export function renderApp(path = "/") {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </ThemeProvider>,
  );
}
