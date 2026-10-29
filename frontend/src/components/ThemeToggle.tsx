import { useTheme } from "../theme/theme-context";
import { MoonIcon, SunIcon } from "./icons";

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggleTheme}
      aria-label={isDark ? "Ativar modo claro" : "Ativar modo escuro"}
      aria-pressed={isDark}
      title={isDark ? "Modo claro" : "Modo escuro"}
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
