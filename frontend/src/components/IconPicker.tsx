import { useEffect, useId, useRef, useState } from "react";

import { CATEGORY_ICONS } from "../lib/options";

interface Props {
  value: string | null;
  onChange: (icon: string | null) => void;
  /** Accessible name of the trigger button. */
  label: string;
}

export default function IconPicker({ value, onChange, label }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function choose(icon: string | null) {
    onChange(icon);
    setOpen(false);
  }

  return (
    <div className="icon-picker" ref={rootRef}>
      <button
        type="button"
        className="icon-picker-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        aria-expanded={open}
        aria-controls={popoverId}
        title={label}
      >
        {value ?? <span className="muted">＋</span>}
      </button>
      {open && (
        <div id={popoverId} className="icon-picker-popover" role="group" aria-label="Ícones">
          {CATEGORY_ICONS.map(({ icon, label: iconLabel }) => (
            <button
              key={icon}
              type="button"
              className={icon === value ? "icon-option selected" : "icon-option"}
              onClick={() => choose(icon)}
              aria-label={iconLabel}
              aria-pressed={icon === value}
              title={iconLabel}
            >
              {icon}
            </button>
          ))}
          <button type="button" className="icon-option-none" onClick={() => choose(null)}>
            Sem ícone
          </button>
        </div>
      )}
    </div>
  );
}
