import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";

import {
  ApiError,
  addCollectionItem,
  createCollection,
  deleteCollection,
  deleteCollectionItem,
  fetchCollections,
  type Currency,
  type SpendingCollection,
} from "../api/client";
import { TrashIcon } from "../components/icons";
import MoneyInput from "../components/MoneyInput";
import { formatCurrency } from "../lib/format";
import { CURRENCIES } from "../lib/options";

export default function Collections() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = Number(searchParams.get("colecao")) || undefined;

  const [collections, setCollections] = useState<SpendingCollection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newCurrency, setNewCurrency] = useState<Currency>("BRL");
  const [itemName, setItemName] = useState("");
  const [itemAmount, setItemAmount] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetchCollections(controller.signal)
      .then(setCollections)
      .catch(
        () => !controller.signal.aborted && setError("Não foi possível carregar as coleções."),
      );
    return () => controller.abort();
  }, []);

  const selected = collections?.find((c) => c.id === selectedId) ?? collections?.[0];

  function select(id: number | undefined) {
    const next = new URLSearchParams(searchParams);
    if (id) next.set("colecao", String(id));
    else next.delete("colecao");
    setSearchParams(next, { replace: true });
  }

  function replace(updated: SpendingCollection) {
    setCollections((prev) => prev?.map((c) => (c.id === updated.id ? updated : c)) ?? null);
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    try {
      const created = await createCollection({ name, currency: newCurrency });
      setCollections((prev) =>
        [...(prev ?? []), created].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
      );
      select(created.id);
      setNewName("");
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? "Já existe uma coleção com esse nome."
          : "Não foi possível criar a coleção.",
      );
    }
  }

  async function handleDeleteCollection(collection: SpendingCollection) {
    if (!window.confirm(`Excluir a coleção "${collection.name}" e todos os itens dela?`)) return;
    try {
      await deleteCollection(collection.id);
      setCollections((prev) => prev?.filter((c) => c.id !== collection.id) ?? null);
      if (selectedId === collection.id) select(undefined);
      setError(null);
    } catch {
      setError("Não foi possível excluir a coleção.");
    }
  }

  const amountValid = itemAmount !== "" && Number(itemAmount) > 0;

  async function handleAddItem(event: FormEvent) {
    event.preventDefault();
    const name = itemName.trim();
    if (!selected || !name || !amountValid) return;
    try {
      replace(await addCollectionItem(selected.id, { name, amount: itemAmount }));
      setItemName("");
      setItemAmount("");
      setError(null);
    } catch {
      setError("Não foi possível adicionar o item.");
    }
  }

  async function handleRemoveItem(collection: SpendingCollection, itemId: number) {
    try {
      replace(await deleteCollectionItem(collection.id, itemId));
      setError(null);
    } catch {
      setError("Não foi possível remover o item.");
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>Coleções</h1>
        <p className="muted">
          Agrupe gastos do mesmo tipo, como Assinaturas, e veja quanto eles somam. Adicione e
          remova itens e o total se atualiza.
        </p>
      </header>

      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      <section className="card" aria-labelledby="collection-new-title">
        <h2 id="collection-new-title" className="card-title">
          Nova coleção
        </h2>
        <form className="inline-form" onSubmit={handleCreate} aria-label="Nova coleção">
          <label className="field grow">
            <span>Nome da coleção</span>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={100}
              placeholder="Ex.: Assinaturas"
            />
          </label>
          <label className="field">
            <span>Moeda</span>
            <select
              value={newCurrency}
              onChange={(e) => setNewCurrency(e.target.value as Currency)}
            >
              {Object.entries(CURRENCIES).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="button primary" disabled={!newName.trim()}>
            Criar coleção
          </button>
        </form>
      </section>

      {collections?.length === 0 && (
        <p className="empty">Nenhuma coleção ainda. Crie uma acima, por exemplo: Assinaturas.</p>
      )}

      {collections && collections.length > 0 && selected && (
        <div className="collections-layout">
          <nav className="card" aria-label="Coleções">
            <ul className="collection-list">
              {collections.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className={c.id === selected.id ? "collection-tab active" : "collection-tab"}
                    aria-current={c.id === selected.id ? "true" : undefined}
                    onClick={() => select(c.id)}
                  >
                    <span>{c.name}</span>
                    <strong>{formatCurrency(c.total, c.currency)}</strong>
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <section className="card" aria-labelledby="collection-detail-title">
            <div className="card-header">
              <h2 id="collection-detail-title" className="card-title">
                {selected.name}
              </h2>
              <button
                type="button"
                className="icon-button danger"
                onClick={() => handleDeleteCollection(selected)}
                aria-label={`Excluir coleção ${selected.name}`}
                title="Excluir coleção"
              >
                <TrashIcon />
              </button>
            </div>

            <p className="collection-total" aria-live="polite">
              <span className="muted">Total</span>
              <strong>{formatCurrency(selected.total, selected.currency)}</strong>
            </p>

            {selected.items.length === 0 ? (
              <p className="empty">Nenhum item. Adicione o primeiro abaixo.</p>
            ) : (
              <ul className="collection-items">
                {selected.items.map((item) => (
                  <li key={item.id}>
                    <span className="grow">{item.name}</span>
                    <span className="value">{formatCurrency(item.amount, selected.currency)}</span>
                    <button
                      type="button"
                      className="icon-button danger"
                      onClick={() => handleRemoveItem(selected, item.id)}
                      aria-label={`Remover ${item.name}`}
                      title="Remover"
                    >
                      <TrashIcon />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <form className="inline-form" onSubmit={handleAddItem} aria-label="Adicionar item">
              <label className="field grow">
                <span>Novo item</span>
                <input
                  value={itemName}
                  onChange={(e) => setItemName(e.target.value)}
                  maxLength={100}
                  placeholder="Ex.: Netflix"
                />
              </label>
              <label className="field">
                <span>Valor</span>
                <MoneyInput
                  value={itemAmount}
                  onChange={setItemAmount}
                  currency={selected.currency}
                />
              </label>
              <button
                type="submit"
                className="button primary"
                disabled={!itemName.trim() || !amountValid}
              >
                Adicionar
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
