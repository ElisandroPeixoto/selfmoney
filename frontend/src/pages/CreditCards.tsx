import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  deleteCard,
  fetchAccounts,
  fetchCards,
  fetchCategories,
  type Account,
  type Category,
  type CreditCard,
} from "../api/client";
import CardBills from "../components/CardBills";
import CardForm from "../components/CardForm";
import CardPurchaseForm from "../components/CardPurchaseForm";
import CardPurchaseList from "../components/CardPurchaseList";
import { EditIcon, TrashIcon } from "../components/icons";
import { formatCurrency } from "../lib/format";

interface Lookups {
  cards: CreditCard[];
  accounts: Account[];
  categories: Category[];
}

export default function CreditCards() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped after any change to purchases or exports, so lists and bills reload.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    Promise.all([fetchCards(signal), fetchAccounts(signal), fetchCategories(signal)])
      .then(([cards, accounts, categories]) => setLookups({ cards, accounts, categories }))
      .catch(() => !signal.aborted && setLoadError(true));
    return () => controller.abort();
  }, []);

  // Refresh the cards' pending totals after purchases or exports change.
  useEffect(() => {
    if (version === 0) return;
    const controller = new AbortController();
    fetchCards(controller.signal)
      .then((cards) => setLookups((prev) => (prev ? { ...prev, cards } : prev)))
      .catch(() => {});
    return () => controller.abort();
  }, [version]);

  const cards = lookups?.cards ?? [];
  const requestedId = Number(searchParams.get("cartao"));
  const card = cards.find((c) => c.id === requestedId) ?? cards[0];

  function select(id: number) {
    setSearchParams({ cartao: String(id) }, { replace: true });
    setEditing(false);
    setError(null);
  }

  function handleSaved(saved: CreditCard) {
    setLookups((prev) => {
      if (!prev) return prev;
      const others = prev.cards.filter((c) => c.id !== saved.id);
      const next = [...others, saved].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
      return { ...prev, cards: next };
    });
    setCreating(false);
    setEditing(false);
    select(saved.id);
  }

  async function handleDeleteCard(target: CreditCard) {
    const ok = window.confirm(
      `Excluir o cartão "${target.name}" e todas as compras dele? ` +
        "Os lançamentos já exportados continuam em Lançamentos.",
    );
    if (!ok) return;
    try {
      await deleteCard(target.id);
      setLookups((prev) =>
        prev ? { ...prev, cards: prev.cards.filter((c) => c.id !== target.id) } : prev,
      );
      setSearchParams({}, { replace: true });
    } catch {
      setError("Não foi possível excluir o cartão.");
    }
  }

  const changed = () => setVersion((v) => v + 1);

  return (
    <div className="page">
      <header className="page-header page-header-row">
        <div>
          <h1>Cartão de Crédito</h1>
          <p className="muted">
            Registre compras parceladas, acompanhe as faturas mês a mês e exporte as parcelas para
            Lançamentos.
          </p>
        </div>
        {cards.length > 0 && !creating && (
          <button type="button" className="button" onClick={() => setCreating(true)}>
            Novo cartão
          </button>
        )}
      </header>

      {loadError && (
        <p role="alert" className="error">
          Não foi possível carregar os cartões.
        </p>
      )}
      {!loadError && lookups === null && <p className="muted">Carregando…</p>}

      {lookups && (cards.length === 0 || creating) && (
        <section className="card" aria-labelledby="new-card-title">
          <h2 id="new-card-title" className="card-title">
            Novo cartão
          </h2>
          {lookups.accounts.length === 0 && (
            <p className="hint">
              Cadastre uma conta em Contas para poder exportar as compras do cartão.
            </p>
          )}
          <CardForm
            accounts={lookups.accounts}
            onSaved={handleSaved}
            onCancel={cards.length > 0 ? () => setCreating(false) : undefined}
          />
        </section>
      )}

      {lookups && card && (
        <>
          <section className="card" aria-labelledby="card-summary-title">
            <div className="card-header">
              <h2 id="card-summary-title" className="card-title">
                {card.name}
              </h2>
              <div className="card-actions">
                {cards.length > 1 && (
                  <select
                    className="compact-select"
                    aria-label="Cartão"
                    value={card.id}
                    onChange={(e) => select(Number(e.target.value))}
                  >
                    {cards.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setEditing((v) => !v)}
                  aria-label={`Editar ${card.name}`}
                  aria-expanded={editing}
                  title="Editar cartão"
                >
                  <EditIcon />
                </button>
                <button
                  type="button"
                  className="icon-button danger"
                  onClick={() => handleDeleteCard(card)}
                  aria-label={`Excluir ${card.name}`}
                  title="Excluir cartão"
                >
                  <TrashIcon />
                </button>
              </div>
            </div>

            <dl className="card-facts">
              <div>
                <dt>Conta vinculada</dt>
                <dd>{card.account_name ?? "Nenhuma"}</dd>
              </div>
              <div>
                <dt>Vencimento</dt>
                <dd>{card.due_day ? `Dia ${card.due_day}` : "Não informado"}</dd>
              </div>
              <div>
                <dt>Exportação</dt>
                <dd>Manual: por fatura ou por compra</dd>
              </div>
              <div>
                <dt>A lançar</dt>
                <dd>
                  <strong>{formatCurrency(card.pending_total, card.currency)}</strong>
                </dd>
              </div>
            </dl>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}

            {editing && (
              <CardForm
                key={card.id}
                accounts={lookups.accounts}
                card={card}
                onSaved={handleSaved}
                onCancel={() => setEditing(false)}
              />
            )}
          </section>

          <section className="card" aria-labelledby="new-purchase-title">
            <h2 id="new-purchase-title" className="card-title">
              Nova compra
            </h2>
            <CardPurchaseForm
              key={card.id}
              card={card}
              categories={lookups.categories}
              onSaved={changed}
            />
          </section>

          <CardBills
            key={`bills-${card.id}`}
            card={card}
            categories={lookups.categories}
            version={version}
            onExported={changed}
          />

          <CardPurchaseList
            card={card}
            categories={lookups.categories}
            version={version}
            onChanged={changed}
          />
        </>
      )}
    </div>
  );
}
