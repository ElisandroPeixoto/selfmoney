import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import {
  ApiError,
  createAccount,
  deleteAccount,
  fetchAccounts,
  updateAccount,
  type Account,
  type Bank,
  type Currency,
} from "../api/client";
import BankLogo from "../components/BankLogo";
import { TrashIcon } from "../components/icons";
import { formatCurrency } from "../lib/format";
import { BANKS, CURRENCIES } from "../lib/options";

type SaveStatus = { kind: "idle" } | { kind: "saved" } | { kind: "error"; message: string };

function conflictMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError && error.status === 409
    ? "Já existe uma conta com esse nome."
    : fallback;
}

interface SelectProps<T> {
  id: string;
  value: T;
  onChange: (value: T) => void;
}

function BankSelect({ id, value, onChange }: SelectProps<Bank | null>) {
  return (
    <select
      id={id}
      value={value ?? ""}
      onChange={(e) => onChange((e.target.value || null) as Bank | null)}
    >
      <option value="">Nenhum</option>
      {(Object.keys(BANKS) as Bank[]).map((bank) => (
        <option key={bank} value={bank}>
          {BANKS[bank].name}
        </option>
      ))}
    </select>
  );
}

function CurrencySelect({ id, value, onChange }: SelectProps<Currency>) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value as Currency)}>
      {(Object.keys(CURRENCIES) as Currency[]).map((code) => (
        <option key={code} value={code}>
          {CURRENCIES[code]}
        </option>
      ))}
    </select>
  );
}

function NewAccountForm({ onCreated }: { onCreated: (a: Account) => void }) {
  const [name, setName] = useState("");
  const [initialBalance, setInitialBalance] = useState("0");
  const [bank, setBank] = useState<Bank | null>(null);
  const [currency, setCurrency] = useState<Currency>("BRL");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createAccount({
        name: trimmed,
        initial_balance: initialBalance || "0",
        bank,
        currency,
      });
      onCreated(created);
      setName("");
      setInitialBalance("0");
      setBank(null);
      setCurrency("BRL");
    } catch (err) {
      setError(conflictMessage(err, "Não foi possível criar a conta."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card" aria-labelledby="new-account-title">
      <h2 id="new-account-title" className="card-title">
        Nova conta
      </h2>
      <form onSubmit={handleSubmit} aria-label="Nova conta">
        <div className="form-grid">
          <label className="field" htmlFor="new-account-name">
            <span>Nome</span>
            <input
              id="new-account-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              placeholder="Ex.: Conta Nubank"
              required
            />
          </label>
          <label className="field" htmlFor="new-account-balance">
            <span>Saldo inicial</span>
            <input
              id="new-account-balance"
              type="number"
              step="0.01"
              inputMode="decimal"
              value={initialBalance}
              onChange={(e) => setInitialBalance(e.target.value)}
            />
          </label>
          <label className="field" htmlFor="new-account-bank">
            <span>Banco</span>
            <BankSelect id="new-account-bank" value={bank} onChange={setBank} />
          </label>
          <label className="field" htmlFor="new-account-currency">
            <span>Moeda</span>
            <CurrencySelect id="new-account-currency" value={currency} onChange={setCurrency} />
          </label>
        </div>
        <div className="form-actions">
          {error && (
            <span role="alert" className="error">
              {error}
            </span>
          )}
          <button type="submit" className="button primary" disabled={saving || !name.trim()}>
            Adicionar conta
          </button>
        </div>
      </form>
    </section>
  );
}

interface EditorProps {
  account: Account;
  onSaved: (a: Account) => void;
  onDeleted: (id: number) => void;
}

function AccountEditor({ account, onSaved, onDeleted }: EditorProps) {
  const [name, setName] = useState(account.name);
  const [bank, setBank] = useState<Bank | null>(account.bank);
  const [currency, setCurrency] = useState<Currency>(account.currency);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });

  const trimmed = name.trim();
  const dirty =
    trimmed !== account.name || bank !== account.bank || currency !== account.currency;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!dirty || !trimmed) return;
    setSaving(true);
    try {
      const updated = await updateAccount(account.id, { name: trimmed, bank, currency });
      onSaved(updated);
      setName(updated.name);
      setStatus({ kind: "saved" });
    } catch (error) {
      setStatus({ kind: "error", message: conflictMessage(error, "Não foi possível salvar.") });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    const ok = window.confirm(
      `Excluir a conta "${account.name}"? Todos os lançamentos dela também serão excluídos.`,
    );
    if (!ok) return;
    try {
      await deleteAccount(account.id);
      onDeleted(account.id);
    } catch {
      setStatus({ kind: "error", message: "Não foi possível excluir a conta." });
    }
  }

  const fieldId = (field: string) => `account-${account.id}-${field}`;
  const edited = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setStatus({ kind: "idle" });
  };

  return (
    <li className="card account-editor">
      <form onSubmit={handleSubmit} aria-label={`Editar conta ${account.name}`}>
        <div className="account-editor-header">
          <BankLogo bank={bank} fallbackLabel={trimmed || account.name} size={40} />
          <div className="grow">
            <strong>{account.name}</strong>
            <p className="muted">
              Saldo: {formatCurrency(account.balance, account.currency)} ·{" "}
              <Link to={`/movimentacoes?conta=${account.id}`}>Movimentações</Link>
            </p>
          </div>
          <button
            type="button"
            className="icon-button danger"
            onClick={handleDelete}
            aria-label={`Excluir ${account.name}`}
            title="Excluir conta"
          >
            <TrashIcon />
          </button>
        </div>

        <div className="form-grid">
          <label className="field" htmlFor={fieldId("name")}>
            <span>Nome</span>
            <input
              id={fieldId("name")}
              value={name}
              onChange={(e) => edited(setName)(e.target.value)}
              maxLength={100}
              required
            />
          </label>
          <label className="field" htmlFor={fieldId("bank")}>
            <span>Banco</span>
            <BankSelect id={fieldId("bank")} value={bank} onChange={edited(setBank)} />
          </label>
          <label className="field" htmlFor={fieldId("currency")}>
            <span>Moeda</span>
            <CurrencySelect
              id={fieldId("currency")}
              value={currency}
              onChange={edited(setCurrency)}
            />
          </label>
        </div>

        {currency !== account.currency && (
          <p className="hint">Alterar a moeda não converte os valores já lançados.</p>
        )}

        <div className="form-actions">
          {status.kind === "saved" && !dirty && <span className="success">Salvo</span>}
          {status.kind === "error" && (
            <span role="alert" className="error">
              {status.message}
            </span>
          )}
          <button type="submit" className="button primary" disabled={!dirty || !trimmed || saving}>
            Salvar
          </button>
        </div>
      </form>
    </li>
  );
}

export default function Accounts() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchAccounts(controller.signal)
      .then(setAccounts)
      .catch(() => !controller.signal.aborted && setLoadError(true));
    return () => controller.abort();
  }, []);

  function handleSaved(updated: Account) {
    setAccounts((prev) => prev?.map((a) => (a.id === updated.id ? updated : a)) ?? null);
  }

  function handleCreated(created: Account) {
    setAccounts((prev) =>
      [...(prev ?? []), created].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    );
  }

  function handleDeleted(id: number) {
    setAccounts((prev) => prev?.filter((a) => a.id !== id) ?? null);
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>Contas</h1>
        <p className="muted">Adicione, edite ou exclua suas contas.</p>
      </header>

      <NewAccountForm onCreated={handleCreated} />

      {loadError && (
        <p role="alert" className="error">
          Não foi possível carregar as contas.
        </p>
      )}
      {!loadError && accounts === null && <p className="muted">Carregando…</p>}
      {accounts?.length === 0 && <p className="empty">Nenhuma conta cadastrada.</p>}
      {accounts && accounts.length > 0 && (
        <ul className="account-editor-list" aria-label="Suas contas">
          {accounts.map((account) => (
            <AccountEditor
              key={account.id}
              account={account}
              onSaved={handleSaved}
              onDeleted={handleDeleted}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
