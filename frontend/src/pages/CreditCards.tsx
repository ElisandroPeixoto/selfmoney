import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  deleteCard,
  deleteCardPurchase,
  fetchAccounts,
  fetchCardPurchases,
  fetchCards,
  fetchCategories,
  type Account,
  type CardPurchase,
  type Category,
  type CreditCard,
} from "../api/client";
import CardBills from "../components/CardBills";
import CardForm from "../components/CardForm";
import CardPurchaseForm from "../components/CardPurchaseForm";
import CategoryLabel from "../components/CategoryLabel";
import { EditIcon, TrashIcon } from "../components/icons";
import { formatCurrency, formatDate, formatMonth } from "../lib/format";
import { UNCATEGORIZED_COLOR } from "../lib/options";

interface Lookups {
  cards: CreditCard[];
  accounts: Account[];
  categories: Category[];
}

interface PurchasesProps {
  card: CreditCard;
  categories: Category[];
  version: number;
  onDeleted: () => void;
}

function PurchaseList({ card, categories, version, onDeleted }: PurchasesProps) {
  const [purchases, setPurchases] = useState<CardPurchase[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchCardPurchases(card.id, controller.signal)
      .then(setPurchases)
      .catch(() => !controller.signal.aborted && setError("Não foi possível carregar as compras."));
    return () => controller.abort();
  }, [card.id, version]);

  async function handleDelete(purchase: CardPurchase) {
    const exported =
      purchase.exported_installments > 0
        ? " As parcelas já exportadas continuam em Lançamentos."
        : "";
    if (!window.confirm(`Excluir a compra "${purchase.description}"?${exported}`)) return;
    try {
      await deleteCardPurchase(card.id, purchase.id);
      onDeleted();
    } catch {
      setError("Não foi possível excluir a compra.");
    }
  }

  const categoriesById = new Map(categories.map((c) => [c.id, c]));

  return (
    <section className="card" aria-labelledby="card-purchases-title">
      <h2 id="card-purchases-title" className="card-title">
        Compras
      </h2>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {purchases === null && !error && <p className="muted">Carregando…</p>}
      {purchases?.length === 0 && <p className="empty">Nenhuma compra neste cartão.</p>}
      {purchases && purchases.length > 0 && (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Data</th>
                <th scope="col">Descrição</th>
                <th scope="col">Categoria</th>
                <th scope="col">Parcelas</th>
                <th scope="col">1ª fatura</th>
                <th scope="col">Lançadas</th>
                <th scope="col" className="num">
                  Total
                </th>
                <th scope="col">
                  <span className="visually-hidden">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((p) => {
                const category =
                  p.category_id !== null ? categoriesById.get(p.category_id) : undefined;
                return (
                  <tr key={p.id}>
                    <td className="nowrap">{formatDate(p.date)}</td>
                    <td>{p.description}</td>
                    <td>
                      <CategoryLabel
                        name={category?.name ?? "Sem categoria"}
                        color={category?.color ?? UNCATEGORIZED_COLOR}
                        icon={category?.icon}
                      />
                    </td>
                    <td className="nowrap">
                      {p.installments}x de {formatCurrency(p.installment_amount, card.currency)}
                    </td>
                    <td className="nowrap">{formatMonth(p.first_year, p.first_month)}</td>
                    <td className="nowrap">
                      {p.exported_installments} de {p.installments}
                    </td>
                    <td className="value nowrap">{formatCurrency(p.amount, card.currency)}</td>
                    <td className="row-actions">
                      <button
                        type="button"
                        className="icon-button danger"
                        onClick={() => handleDelete(p)}
                        aria-label={`Excluir ${p.description}`}
                        title="Excluir compra"
                      >
                        <TrashIcon />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
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
                <dd>{card.auto_export ? "Automática" : "Manual, por fatura"}</dd>
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
              onCreated={changed}
            />
          </section>

          <CardBills
            key={`bills-${card.id}`}
            card={card}
            categories={lookups.categories}
            version={version}
            onExported={changed}
          />

          <PurchaseList
            card={card}
            categories={lookups.categories}
            version={version}
            onDeleted={changed}
          />
        </>
      )}
    </div>
  );
}
