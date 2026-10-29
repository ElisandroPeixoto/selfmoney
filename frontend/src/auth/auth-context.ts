import { createContext, useContext } from "react";

export interface AuthContextValue {
  /** False when the server has no password set (development). */
  authRequired: boolean;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue>({
  authRequired: false,
  logout: () => {},
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
