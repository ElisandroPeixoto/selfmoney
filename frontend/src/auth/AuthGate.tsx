import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import type { AuthStatus } from "../api/client";
import Login from "../pages/Login";
import { AuthContext } from "./auth-context";
import { clearToken, UNAUTHORIZED_EVENT } from "./session";

interface Props {
  /** Asked before the first render (main.tsx), so the app never flashes before the login. */
  initialStatus: AuthStatus;
  children: ReactNode;
}

export default function AuthGate({ initialStatus, children }: Props) {
  const authRequired = initialStatus.auth_required;
  const [authenticated, setAuthenticated] = useState(initialStatus.authenticated);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    function handleUnauthorized() {
      setExpired(true);
      setAuthenticated(false);
    }
    window.addEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setExpired(false);
    setAuthenticated(false);
  }, []);
  const value = useMemo(() => ({ authRequired, logout }), [authRequired, logout]);

  if (authRequired && !authenticated) {
    return <Login expired={expired} onLoggedIn={() => setAuthenticated(true)} />;
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
