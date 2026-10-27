interface Props {
  name: string;
  color: string;
  icon?: string | null;
}

/** Category name with its color swatch and, when set, its icon. */
export default function CategoryLabel({ name, color, icon }: Props) {
  return (
    <span className="category-label">
      <span className="swatch" style={{ background: color }} />
      {icon && (
        <span className="category-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      {name}
    </span>
  );
}
