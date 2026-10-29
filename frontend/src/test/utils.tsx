import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";

import type { AuthStatus } from "../api/client";
import App from "../App";
import { ThemeProvider } from "../theme/ThemeProvider";

type Handler = (init: RequestInit | undefined) => {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
};

/** Mocks fetch with handlers keyed by "METHOD /path" (query string ignored). */
export function mockApi(routes: Record<string, Handler>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input), "http://localhost");
    const key = `${init?.method ?? "GET"} ${url.pathname}`;
    const handler = routes[key];
    if (!handler) throw new Error(`Unexpected request: ${key}`);
    const { status = 200, body, headers } = handler(init);
    return {
      ok: status < 400,
      status,
      headers: new Headers(headers),
      json: async () => body,
      // Binary responses (e.g. PDFs) pass a Blob as the body.
      blob: async () => (body instanceof Blob ? body : new Blob([JSON.stringify(body)])),
    } as Response;
  });
}

const NO_LOGIN: AuthStatus = { auth_required: false, authenticated: true };

/** Renders the whole app; pass an auth status to test the login (default: no password). */
export function renderApp(path = "/", authStatus: AuthStatus = NO_LOGIN) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <App authStatus={authStatus} />
      </MemoryRouter>
    </ThemeProvider>,
  );
}
