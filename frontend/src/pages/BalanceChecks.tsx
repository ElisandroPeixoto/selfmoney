import { useEffect, useState } from "react";

import {
  deleteBalanceCheck,
  fetchBalanceChecks,
  recordBalanceCheck,
  type BalanceCheck,
} from "../api/client";
import { TrashIcon } from "../components/icons";
import { formatDateTimeWithWeekday } from "../lib/format";

export default function BalanceChecks() {
  const [checks, setChecks] = useState<BalanceCheck[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchBalanceChecks(controller.signal)
      .then(setChecks)
      .catch(
        () => !controller.signal.aborted && setError("Não foi possível carregar os balanços."),
      );
    return () => controller.abort();
  }, []);

  async function handleRecord() {
    setSaving(true);
    try {
      const check = await recordBalanceCheck();
      setChecks((prev) => [check, ...(prev ?? [])]);
      setNotice(`Balanço registrado em ${formatDateTimeWithWeekday(check.created_at)}.`);
      setError(null);
    } catch {
      setNotice(null);
      setError("Não foi possível registrar o balanço.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(check: BalanceCheck) {
    const when = formatDateTimeWithWeekday(check.created_at);
    if (!window.confirm(`Excluir o registro de ${when}?`)) return;
    try {
      await deleteBalanceCheck(check.id);
      setChecks((prev) => prev?.filter((c) => c.id !== check.id) ?? null);
      setNotice(null);
      setError(null);
    } catch {
      setError("Não foi possível excluir o registro.");
    }
  }

  const last = checks?.[0];

  return (
    <div className="page">
      <header className="page-header">
        <h1>Balanços</h1>
        <p className="muted">
          Registre o dia e a hora em que você fez o balanço financeiro. Basta apertar o botão
          quando terminar a revisão.
        </p>
      </header>

      <section className="card" aria-labelledby="balance-record-title">
        <h2 id="balance-record-title" className="card-title">
          Último balanço
        </h2>
        {checks === null && !error && <p className="muted">Carregando…</p>}
        {checks && (
          <p className="balance-last">
            {last ? (
              <strong>{formatDateTimeWithWeekday(last.created_at)}</strong>
            ) : (
              "Nenhum balanço registrado."
            )}
          </p>
        )}
        <div className="button-row">
          <button type="button" className="button primary" onClick={handleRecord} disabled={saving}>
            Registrar balanço agora
          </button>
        </div>
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </section>

      <section className="card" aria-labelledby="balance-history-title">
        <h2 id="balance-history-title" className="card-title">
          Histórico
        </h2>
        {checks?.length === 0 && <p className="empty">Os balanços registrados aparecerão aqui.</p>}
        {checks && checks.length > 0 && (
          <ul className="balance-list">
            {checks.map((check) => (
              <li key={check.id}>
                <span>{formatDateTimeWithWeekday(check.created_at)}</span>
                <button
                  type="button"
                  className="icon-button danger"
                  onClick={() => handleDelete(check)}
                  aria-label={`Excluir balanço de ${formatDateTimeWithWeekday(check.created_at)}`}
                  title="Excluir"
                >
                  <TrashIcon />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
