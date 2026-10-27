import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  fetchAccounts,
  fetchMovements,
  type Account,
  type Movement,
  type MovementKind,
} from "../api/client";
import MovementForm from "../components/MovementForm";
import { formatCurrency, formatDateTime } from "../lib/format";
import { MOVEMENT_KIND_LABELS as KIND_LABELS } from "../lib/options";

const KINDS = Object.keys(KIND_LABELS) as MovementKind[];

function parseKind(value: string | null): MovementKind | undefined {
  return KINDS.find((k) => k === value);
}

function AccountName({ id, name }: { id: number | null; name: string | null }) {
  if (!name) return <span className="muted">—</span>;
  return (
    <span>
      {name}
      {id === null && <span className="muted"> (excluída)</span>}
    </span>
  );
}

export default function Movements() {
  const [searchParams, setSearchParams] = useSearchParams();
  const formKind = parseKind(searchParams.get("tipo")) ?? "transfer";
  const accountFilter = Number(searchParams.get("conta")) || undefined;
  const kindFilter = parseKind(searchParams.get("filtro"));

  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [log, setLog] = useState<Movement[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchAccounts(controller.signal)
      .then(setAccounts)
      .catch(() => !controller.signal.aborted && setLoadError(true));
    return () => controller.abort();
  }, [reloadKey]);

  useEffect(() => {
    const controller = new AbortController();
    fetchMovements({ accountId: accountFilter, kind: kindFilter }, controller.signal)
      .then(setLog)
      .catch(() => !controller.signal.aborted && setLoadError(true));
    return () => controller.abort();
  }, [accountFilter, kindFilter, reloadKey]);

  function updateParam(key: string, value: string | undefined) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  }

  function handleRecorded(movement: Movement) {
    setNotice(`${KIND_LABELS[movement.kind]} registrada no histórico.`);
    setReloadKey((k) => k + 1);
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>Movimentações</h1>
        <p className="muted">
          Transfira entre contas ou adicione e retire dinheiro sem vincular a um mês. Tudo fica
          registrado no histórico.
        </p>
      </header>

      {loadError && (
        <p role="alert" className="error">
          Não foi possível carregar as movimentações.
        </p>
      )}

      {accounts && (
        <MovementForm
          // Remount on reload so account balances in the selects are fresh.
          key={reloadKey}
          accounts={accounts}
          kind={formKind}
          onKindChange={(kind) => updateParam("tipo", kind === "transfer" ? undefined : kind)}
          onRecorded={handleRecorded}
        />
      )}

      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}

      <section className="card" aria-labelledby="movement-log-title">
        <div className="card-header">
          <h2 id="movement-log-title" className="card-title">
            Histórico de movimentações
          </h2>
        </div>
        <div className="filters log-filters" role="group" aria-label="Filtrar histórico">
          <label className="field" htmlFor="log-account">
            <span>Conta</span>
            <select
              id="log-account"
              value={accountFilter ?? ""}
              onChange={(e) => updateParam("conta", e.target.value || undefined)}
            >
              <option value="">Todas</option>
              {accounts?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field" htmlFor="log-kind">
            <span>Tipo</span>
            <select
              id="log-kind"
              value={kindFilter ?? ""}
              onChange={(e) => updateParam("filtro", e.target.value || undefined)}
            >
              <option value="">Todos</option>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {log === null && !loadError && <p className="muted">Carregando…</p>}
        {log?.length === 0 && <p className="empty">Nenhuma movimentação registrada.</p>}
        {log && log.length > 0 && (
          <div className="table-scroll">
            <table className="data-table" aria-label="Histórico de movimentações">
              <thead>
                <tr>
                  <th scope="col">Data e hora</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">De</th>
                  <th scope="col">Para</th>
                  <th scope="col" className="num">
                    Valor
                  </th>
                  <th scope="col">Justificativa</th>
                </tr>
              </thead>
              <tbody>
                {log.map((m) => (
                  <tr key={m.id}>
                    <td className="nowrap">{formatDateTime(m.created_at)}</td>
                    <td>
                      <span className={`kind-badge kind-${m.kind}`}>{KIND_LABELS[m.kind]}</span>
                    </td>
                    <td>
                      <AccountName id={m.from_account_id} name={m.from_account_name} />
                    </td>
                    <td>
                      <AccountName id={m.to_account_id} name={m.to_account_name} />
                    </td>
                    <td className="value nowrap">{formatCurrency(m.amount, m.currency)}</td>
                    <td className="reason-cell">{m.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
