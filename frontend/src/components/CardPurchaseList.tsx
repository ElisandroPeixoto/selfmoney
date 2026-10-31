import { useEffect, useState } from "react";

import {
  deleteCardPurchase,
  exportCardPurchases,
  fetchCardPurchases,
  type CardPurchase,
  type Category,
  type CreditCard,
} from "../api/client";
import { formatCurrency, formatDate, formatMonth } from "../lib/format";
import { UNCATEGORIZED_COLOR } from "../lib/options";
import CardPurchaseForm from "./CardPurchaseForm";
import CategoryLabel from "./CategoryLabel";
import { EditIcon, SendIcon, TrashIcon } from "./icons";

interface Props {
  card: CreditCard;
  categories: Category[];
  /** Changes whenever purchases change, so the list is fetched again. */
  version: number;
  onChanged: () => void;
}

function isPending(purchase: CardPurchase): boolean {
  return purchase.exported_installments < purchase.installments;
}

/** Purchases of a card, with edit, delete and (single or bulk) export to the transactions. */
export default function CardPurchaseList({ card, categories, version, onChanged }: Props) {
  const [purchases, setPurchases] = useState<CardPurchase[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [sending, setSending] = useState(false);

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
      setError(null);
      onChanged();
    } catch {
      setError("Não foi possível excluir a compra.");
    }
  }

  async function send(targets: CardPurchase[]) {
    if (targets.length === 0) return;
    const pending = targets.reduce((sum, p) => sum + p.installments - p.exported_installments, 0);
    const what =
      targets.length === 1 ? `a compra "${targets[0].description}"` : `${targets.length} compras`;
    const ok = window.confirm(
      `Lançar ${pending} parcela(s) de ${what} em Lançamentos, na conta ${card.account_name}?`,
    );
    if (!ok) return;
    setSending(true);
    try {
      const result = await exportCardPurchases(
        card.id,
        targets.map((p) => p.id),
      );
      setSelected(new Set());
      setError(null);
      setNotice(`${result.created} lançamento(s) criado(s) na conta ${card.account_name}.`);
      onChanged();
    } catch {
      setNotice(null);
      setError("Não foi possível enviar para Lançamentos.");
    } finally {
      setSending(false);
    }
  }

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  const categoriesById = new Map(categories.map((c) => [c.id, c]));
  const sendable = purchases?.filter(isPending) ?? [];
  // Ids that were sent or deleted since they were ticked simply fall out of the selection.
  const checked = sendable.filter((p) => selected.has(p.id));
  const allChecked = sendable.length > 0 && checked.length === sendable.length;
  const editing = purchases?.find((p) => p.id === editingId);
  const noAccount = card.account_id === null;

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
      {notice && (
        <p role="status" className="success">
          {notice}
        </p>
      )}
      {purchases === null && !error && <p className="muted">Carregando…</p>}
      {purchases?.length === 0 && <p className="empty">Nenhuma compra neste cartão.</p>}

      {editing && (
        <div className="purchase-editor">
          <h3 className="card-title">Editar compra</h3>
          <CardPurchaseForm
            key={editing.id}
            card={card}
            categories={categories}
            purchase={editing}
            onSaved={() => {
              setEditingId(null);
              setNotice(null);
              onChanged();
            }}
            onCancel={() => setEditingId(null)}
          />
        </div>
      )}

      {purchases && purchases.length > 0 && (
        <>
          <div className="form-actions">
            {noAccount && sendable.length > 0 && (
              <span className="muted">Vincule o cartão a uma conta para enviar.</span>
            )}
            <button
              type="button"
              className="button primary"
              onClick={() => send(checked)}
              disabled={sending || noAccount || checked.length === 0}
            >
              Enviar selecionadas para Lançamentos
              {checked.length > 0 ? ` (${checked.length})` : ""}
            </button>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">
                    <input
                      type="checkbox"
                      aria-label="Selecionar todas as compras pendentes"
                      checked={allChecked}
                      disabled={sendable.length === 0}
                      onChange={() =>
                        setSelected(allChecked ? new Set() : new Set(sendable.map((p) => p.id)))
                      }
                    />
                  </th>
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
                  const pending = isPending(p);
                  return (
                    <tr key={p.id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Selecionar ${p.description}`}
                          checked={pending && selected.has(p.id)}
                          disabled={!pending}
                          onChange={() => toggle(p.id)}
                        />
                      </td>
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
                          className="icon-button"
                          onClick={() => send([p])}
                          disabled={sending || noAccount || !pending}
                          aria-label={`Enviar ${p.description} para Lançamentos`}
                          title={pending ? "Enviar para Lançamentos" : "Já enviada"}
                        >
                          <SendIcon />
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          onClick={() => setEditingId(p.id)}
                          aria-label={`Editar ${p.description}`}
                          title="Editar compra"
                        >
                          <EditIcon />
                        </button>
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
        </>
      )}
    </section>
  );
}
