import { useTheme } from "../theme/theme-context";
import { MoonIcon, SunIcon } from "./icons";

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";
  const label = isDark ? "Modo claro" : "Modo escuro";
  return (
    <button
      type="button"
      className="sidebar-button"
      onClick={toggleTheme}
      aria-label={isDark ? "Ativar modo claro" : "Ativar modo escuro"}
      aria-pressed={isDark}
      title={label}
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
      <span className="sidebar-label">{label}</span>
    </button>
  );
}
