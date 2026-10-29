import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";

import {
  ApiError,
  createCategory,
  deleteCategory,
  fetchCategories,
  updateCategory,
  type Category,
  type TransactionType,
} from "../api/client";
import IconPicker from "../components/IconPicker";
import { TrashIcon } from "../components/icons";
import { nextCategoryColor } from "../lib/options";

const KINDS: { kind: TransactionType; label: string; param: string }[] = [
  { kind: "expense", label: "Despesas", param: "despesas" },
  { kind: "income", label: "Receitas", param: "receitas" },
];

// The native color picker reports every drag step; save once the user pauses.
const COLOR_SAVE_DELAY_MS = 400;

interface RowProps {
  category: Category;
  onChange: (updated: Category) => void;
  onRemove: (category: Category) => void;
  onError: (message: string) => void;
}

function CategoryRow({ category, onChange, onRemove, onError }: RowProps) {
  const [color, setColor] = useState(category.color);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const otherKind = category.kind === "expense" ? KINDS[1] : KINDS[0];

  useEffect(() => () => clearTimeout(timer.current), []);

  async function save(changes: Parameters<typeof updateCategory>[1], failure: string) {
    try {
      onChange(await updateCategory(category.id, changes));
    } catch (error) {
      onError(
        error instanceof ApiError && error.status === 409
          ? `"${category.name}" já tem lançamentos do tipo atual e não pode mudar de lista.`
          : failure,
      );
    }
  }

  function handleColor(value: string) {
    setColor(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(
      () => save({ color: value }, `Não foi possível alterar a cor de "${category.name}".`),
      COLOR_SAVE_DELAY_MS,
    );
  }

  return (
    <li className="item-row">
      <IconPicker
        value={category.icon}
        onChange={(icon) => save({ icon }, `Não foi possível alterar o ícone de "${category.name}".`)}
        label={`Alterar ícone de ${category.name}`}
      />
      <input
        type="color"
        className="color-swatch-input"
        value={color}
        onChange={(e) => handleColor(e.target.value)}
        aria-label={`Cor de ${category.name}`}
        title="Alterar cor"
      />
      <span className="grow">{category.name}</span>
      <button
        type="button"
        className="link-button"
        onClick={() =>
          save(
            { kind: otherKind.kind },
            `Não foi possível mover "${category.name}" para ${otherKind.label}.`,
          )
        }
      >
        Mover para {otherKind.label.toLowerCase()}
      </button>
      <button
        type="button"
        className="icon-button danger"
        onClick={() => onRemove(category)}
        aria-label={`Remover ${category.name}`}
        title="Remover"
      >
        <TrashIcon />
      </button>
    </li>
  );
}

export default function Categories() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = KINDS.find((k) => k.param === searchParams.get("tipo")) ?? KINDS[0];

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

  const visible = categories?.filter((c) => c.kind === tab.kind) ?? null;
  // Until the user picks a color, suggest the next unused palette color.
  const effectiveColor = color ?? nextCategoryColor(categories?.map((c) => c.color) ?? []);

  function sortByName(list: Category[]): Category[] {
    return [...list].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }

  function replace(updated: Category) {
    setFormError(null);
    setCategories((prev) => prev?.map((c) => (c.id === updated.id ? updated : c)) ?? null);
  }

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    setFormError(null);
    try {
      const created = await createCategory({
        name: trimmed,
        color: effectiveColor,
        icon,
        kind: tab.kind,
      });
      setCategories((prev) => sortByName([...(prev ?? []), created]));
      setName("");
      setColor(null);
      setIcon(null);
    } catch (error) {
      setFormError(
        error instanceof ApiError && error.status === 409
          ? "Já existe uma categoria com esse nome."
          : "Não foi possível adicionar a categoria.",
      );
    }
    setSaving(false);
  }

  async function handleRemove(category: Category) {
    const what = category.kind === "expense" ? "Os gastos" : "As receitas";
    const ok = window.confirm(
      `Remover a categoria "${category.name}"? ${what} dela ficarão sem categoria.`,
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
        <p className="muted">Organize suas despesas e receitas por categoria.</p>
      </header>

      <div className="segmented" role="tablist" aria-label="Tipo de categoria">
        {KINDS.map((k) => (
          <button
            key={k.kind}
            type="button"
            role="tab"
            aria-selected={tab.kind === k.kind}
            className={tab.kind === k.kind ? "segment active" : "segment"}
            onClick={() => {
              setSearchParams(k.kind === "expense" ? {} : { tipo: k.param }, { replace: true });
              setFormError(null);
            }}
          >
            {k.label}
          </button>
        ))}
      </div>

      <section className="card" aria-labelledby="new-category-title">
        <h2 id="new-category-title" className="card-title">
          Nova categoria de {tab.label.toLowerCase()}
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
              placeholder={tab.kind === "expense" ? "Ex.: Educação" : "Ex.: Salário"}
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
          Categorias de {tab.label.toLowerCase()}
        </h2>
        {loadError && (
          <p role="alert" className="error">
            Não foi possível carregar as categorias.
          </p>
        )}
        {!loadError && visible === null && <p className="muted">Carregando…</p>}
        {visible?.length === 0 && (
          <p className="empty">Nenhuma categoria de {tab.label.toLowerCase()} cadastrada.</p>
        )}
        {visible && visible.length > 0 && (
          <ul className="item-list">
            {visible.map((category) => (
              <CategoryRow
                key={category.id}
                category={category}
                onChange={replace}
                onRemove={handleRemove}
                onError={setFormError}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
