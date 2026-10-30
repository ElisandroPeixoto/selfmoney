import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  deleteMovement,
  fetchAccounts,
  fetchMovements,
  type Account,
  type Movement,
  type MovementKind,
} from "../api/client";
import { EditIcon, TrashIcon } from "../components/icons";
import MovementEditor from "../components/MovementEditor";
import MovementForm from "../components/MovementForm";
import { formatCurrency, formatDateTime } from "../lib/format";
import { MOVEMENT_KIND_LABELS as KIND_LABELS } from "../lib/options";

const KINDS = Object.keys(KIND_LABELS) as MovementKind[];

function parseKind(value: string | null): MovementKind | undefined {
  return KINDS.find((k) => k === value);
}

function parseDay(value: string | null): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
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
  const fromFilter = parseDay(searchParams.get("de"));
  const toFilter = parseDay(searchParams.get("ate"));
  // Swapped bounds would match nothing; the inputs' min/max make this rare.
  const datesValid = !fromFilter || !toFilter || fromFilter <= toFilter;

  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [log, setLog] = useState<Movement[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchAccounts(controller.signal)
      .then(setAccounts)
      .catch(() => !controller.signal.aborted && setLoadError(true));
    return () => controller.abort();
  }, [reloadKey]);

  useEffect(() => {
    if (!datesValid) return;
    const controller = new AbortController();
    fetchMovements(
      {
        accountId: accountFilter,
        kind: kindFilter,
        from: fromFilter,
        to: toFilter,
      },
      controller.signal,
    )
      .then(setLog)
      .catch(() => !controller.signal.aborted && setLoadError(true));
    return () => controller.abort();
  }, [accountFilter, kindFilter, fromFilter, toFilter, datesValid, reloadKey]);

  function updateParam(key: string, value: string | undefined) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  }

  function clearDates() {
    const next = new URLSearchParams(searchParams);
    next.delete("de");
    next.delete("ate");
    setSearchParams(next, { replace: true });
  }

  function handleRecorded(movement: Movement) {
    setNotice(`${KIND_LABELS[movement.kind]} registrada no histórico.`);
    setReloadKey((k) => k + 1);
  }

  function handleEdited(movement: Movement) {
    setEditingId(null);
    setNotice(`${KIND_LABELS[movement.kind]} atualizada no histórico.`);
    // Balances in the form and in the log's accounts may have changed.
    setReloadKey((k) => k + 1);
  }

  async function handleDelete(movement: Movement) {
    const label = KIND_LABELS[movement.kind].toLowerCase();
    const amount = formatCurrency(movement.amount, movement.currency);
    const ok = window.confirm(
      `Excluir a ${label} de ${amount} (${movement.reason})? ` +
        "Os saldos das contas voltam a ficar como se ela não tivesse acontecido.",
    );
    if (!ok) return;
    setDeleteError(false);
    try {
      await deleteMovement(movement.id);
      if (editingId === movement.id) setEditingId(null);
      setNotice(`${KIND_LABELS[movement.kind]} de ${amount} excluída do histórico.`);
      // Reload the accounts too: their balances in the form change.
      setReloadKey((k) => k + 1);
    } catch {
      setNotice(null);
      setDeleteError(true);
    }
  }

  const editing = log?.find((m) => m.id === editingId);

  return (
    <div className="page">
      <header className="page-header">
        <h1>Movimentações</h1>
        <p className="muted">
          Transfira entre contas ou adicione e retire dinheiro sem vincular a um mês. Tudo fica
          registrado no histórico, de onde também dá para excluir uma movimentação.
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
          <label className="field" htmlFor="log-from">
            <span>Data inicial</span>
            <input
              id="log-from"
              type="date"
              value={fromFilter ?? ""}
              max={toFilter}
              onChange={(e) => updateParam("de", e.target.value || undefined)}
            />
          </label>
          <label className="field" htmlFor="log-to">
            <span>Data final</span>
            <input
              id="log-to"
              type="date"
              value={toFilter ?? ""}
              min={fromFilter}
              onChange={(e) => updateParam("ate", e.target.value || undefined)}
            />
          </label>
          {(fromFilter || toFilter) && (
            <button type="button" className="button filter-clear" onClick={clearDates}>
              Limpar datas
            </button>
          )}
        </div>

        {deleteError && (
          <p role="alert" className="error">
            Não foi possível excluir a movimentação.
          </p>
        )}
        {!datesValid && (
          <p role="alert" className="error">
            A data inicial precisa ser anterior ou igual à data final.
          </p>
        )}
        {datesValid && log === null && !loadError && <p className="muted">Carregando…</p>}
        {datesValid && log?.length === 0 && (
          <p className="empty">
            {fromFilter || toFilter
              ? "Nenhuma movimentação neste período."
              : "Nenhuma movimentação registrada."}
          </p>
        )}
        {editing && accounts && (
          <MovementEditor
            key={editing.id}
            movement={editing}
            accounts={accounts}
            onSaved={handleEdited}
            onCancel={() => setEditingId(null)}
          />
        )}
        {datesValid && log && log.length > 0 && (
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
                  <th scope="col">
                    <span className="visually-hidden">Ações</span>
                  </th>
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
                    <td className="row-actions">
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => setEditingId(m.id)}
                        aria-label={`Editar ${KIND_LABELS[m.kind].toLowerCase()}: ${m.reason}`}
                        title="Editar movimentação"
                      >
                        <EditIcon />
                      </button>
                      <button
                        type="button"
                        className="icon-button danger"
                        onClick={() => handleDelete(m)}
                        aria-label={`Excluir ${KIND_LABELS[m.kind].toLowerCase()}: ${m.reason}`}
                        title="Excluir movimentação"
                      >
                        <TrashIcon />
                      </button>
                    </td>
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
