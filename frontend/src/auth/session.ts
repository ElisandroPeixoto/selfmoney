/** The login token, kept in localStorage so the session survives reloads. */
export const TOKEN_STORAGE_KEY = "selfmoney.token";

/** Fired by the API client when the server rejects the token (expired or revoked). */
export const UNAUTHORIZED_EVENT = "selfmoney:unauthorized";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // Without storage the session lasts until the page is reloaded.
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Nothing stored, nothing to clear.
  }
}
