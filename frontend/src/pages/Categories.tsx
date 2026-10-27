import { useEffect, useState, type FormEvent } from "react";

import {
  ApiError,
  createCategory,
  deleteCategory,
  fetchCategories,
  updateCategory,
  type Category,
} from "../api/client";
import CategoryLabel from "../components/CategoryLabel";
import IconPicker from "../components/IconPicker";
import { TrashIcon } from "../components/icons";
import { nextCategoryColor } from "../lib/options";

export default function Categories() {
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [icon, setIcon] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchCategories(controller.signal)
      .then(setCategories)
      .catch(() => !controller.signal.aborted && setLoadError(true));
    return () => controller.abort();
  }, []);

  // Until the user picks a color, suggest the next unused palette color.
  const effectiveColor = color ?? nextCategoryColor(categories?.map((c) => c.color) ?? []);

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    setFormError(null);
    try {
      const created = await createCategory({ name: trimmed, color: effectiveColor, icon });
      setCategories((prev) =>
        [...(prev ?? []), created].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
      );
      setName("");
      setColor(null);
      setIcon(null);
    } catch (error) {
      setFormError(
        error instanceof ApiError && error.status === 409
          ? "Já existe uma categoria com esse nome."
          : "Não foi possível adicionar a categoria.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleIconChange(category: Category, newIcon: string | null) {
    try {
      const updated = await updateCategory(category.id, { icon: newIcon });
      setCategories((prev) => prev?.map((c) => (c.id === updated.id ? updated : c)) ?? null);
    } catch {
      setFormError(`Não foi possível alterar o ícone de "${category.name}".`);
    }
  }

  async function handleRemove(category: Category) {
    const ok = window.confirm(
      `Remover a categoria "${category.name}"? Os gastos dela ficarão sem categoria.`,
    );
    if (!ok) return;
    try {
      await deleteCategory(category.id);
      setCategories((prev) => prev?.filter((c) => c.id !== category.id) ?? null);
    } catch {
      setFormError(`Não foi possível remover "${category.name}".`);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>Categorias</h1>
        <p className="muted">Organize seus gastos por categoria.</p>
      </header>

      <section className="card" aria-labelledby="new-category-title">
        <h2 id="new-category-title" className="card-title">
          Nova categoria
        </h2>
        <form className="inline-form" onSubmit={handleAdd}>
          <div className="field">
            <span>Ícone</span>
            <IconPicker value={icon} onChange={setIcon} label="Escolher ícone da nova categoria" />
          </div>
          <label className="field grow">
            <span>Nome</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              placeholder="Ex.: Educação"
              required
            />
          </label>
          <label className="field">
            <span>Cor</span>
            <input
              type="color"
              value={effectiveColor}
              onChange={(e) => setColor(e.target.value)}
              className="color-input"
            />
          </label>
          <button type="submit" className="button primary" disabled={saving || !name.trim()}>
            Adicionar
          </button>
        </form>
        {formError && (
          <p role="alert" className="error">
            {formError}
          </p>
        )}
      </section>

      <section className="card" aria-labelledby="category-list-title">
        <h2 id="category-list-title" className="card-title">
          Suas categorias
        </h2>
        {loadError && (
          <p role="alert" className="error">
            Não foi possível carregar as categorias.
          </p>
        )}
        {!loadError && categories === null && <p className="muted">Carregando…</p>}
        {categories?.length === 0 && <p className="empty">Nenhuma categoria cadastrada.</p>}
        {categories && categories.length > 0 && (
          <ul className="item-list">
            {categories.map((category) => (
              <li key={category.id} className="item-row">
                <IconPicker
                  value={category.icon}
                  onChange={(newIcon) => handleIconChange(category, newIcon)}
                  label={`Alterar ícone de ${category.name}`}
                />
                <span className="grow">
                  <CategoryLabel name={category.name} color={category.color} />
                </span>
                <button
                  type="button"
                  className="icon-button danger"
                  onClick={() => handleRemove(category)}
                  aria-label={`Remover ${category.name}`}
                  title="Remover"
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
