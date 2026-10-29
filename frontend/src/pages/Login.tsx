import { useState, type FormEvent } from "react";

import { ApiError, login } from "../api/client";
import logoDark from "../assets/brand/logo-dark.png";
import logoLight from "../assets/brand/logo-light.png";
import { setToken } from "../auth/session";
import { useTheme } from "../theme/theme-context";

interface Props {
  /** The previous session ended (expired token or password change). */
  expired: boolean;
  onLoggedIn: () => void;
}

export default function Login({ expired, onLoggedIn }: Props) {
  const { theme } = useTheme();
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!password) return;
    setSubmitting(true);
    setError(null);
    try {
      const { token } = await login(password);
      setToken(token);
      onLoggedIn();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? "Senha incorreta."
          : "Não foi possível entrar. Verifique se a API está rodando.",
      );
      setPassword("");
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="card login-card" aria-labelledby="login-title">
        <img className="login-logo" src={theme === "dark" ? logoDark : logoLight} alt="" />
        <h1 id="login-title">SelfMoney</h1>
        <p className="muted">Digite a senha para acessar suas finanças.</p>
        {expired && (
          <p className="notice" role="status">
            Sua sessão terminou. Entre novamente.
          </p>
        )}
        <form className="login-form" onSubmit={handleSubmit} aria-label="Entrar">
          <label className="field" htmlFor="login-password">
            <span>Senha</span>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              // The only field on the screen: start typing right away.
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button type="submit" className="button primary" disabled={submitting || !password}>
            {submitting ? "Entrando…" : "Entrar"}
          </button>
        </form>
      </section>
    </main>
  );
}
