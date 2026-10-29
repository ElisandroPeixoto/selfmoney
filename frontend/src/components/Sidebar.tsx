import { useEffect, useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";

import logoDark from "../assets/brand/logo-dark.png";
import logoLight from "../assets/brand/logo-light.png";
import { useTheme } from "../theme/theme-context";
import {
  BudgetIcon,
  CollapseIcon,
  DashboardIcon,
  ListIcon,
  TagIcon,
  TransferIcon,
  WalletIcon,
} from "./icons";
import ThemeToggle from "./ThemeToggle";

export const SIDEBAR_STORAGE_KEY = "selfmoney.sidebar.collapsed";

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
}

const DASHBOARD: NavItem = { to: "/", label: "Dashboard", icon: <DashboardIcon /> };

// Kept in alphabetical order regardless of how they are listed here.
const NAV_ITEMS: NavItem[] = [
  { to: "/lancamentos", label: "Lançamentos", icon: <ListIcon /> },
  { to: "/orcamentos", label: "Orçamentos", icon: <BudgetIcon />, end: false },
  { to: "/movimentacoes", label: "Movimentações", icon: <TransferIcon /> },
  { to: "/contas", label: "Contas", icon: <WalletIcon /> },
  { to: "/categorias", label: "Categorias", icon: <TagIcon /> },
].sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function NavItemLink({
  item,
  collapsed,
  className = "nav-link",
}: {
  item: NavItem;
  collapsed: boolean;
  className?: string;
}) {
  return (
    <NavLink
      to={item.to}
      end={item.end ?? true}
      className={className}
      title={collapsed ? item.label : undefined}
      aria-label={collapsed ? item.label : undefined}
    >
      {item.icon}
      <span className="sidebar-label">{item.label}</span>
    </NavLink>
  );
}

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const { theme } = useTheme();

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(collapsed));
    } catch {
      // Persistence is a convenience; ignore storage failures.
    }
  }, [collapsed]);

  return (
    <aside className={collapsed ? "sidebar collapsed" : "sidebar"}>
      <div className="sidebar-header">
        <div className="brand">
          <img
            className="brand-logo"
            src={theme === "dark" ? logoDark : logoLight}
            // The visible name already labels the logo, except when collapsed hides it.
            alt={collapsed ? "SelfMoney" : ""}
          />
          <span className="brand-name">SelfMoney</span>
        </div>
        <button
          type="button"
          className="collapse-button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expandir barra lateral" : "Recolher barra lateral"}
          aria-expanded={!collapsed}
          title={collapsed ? "Expandir" : "Recolher"}
        >
          <CollapseIcon collapsed={collapsed} />
        </button>
      </div>
      <nav aria-label="Principal">
        <ul className="nav-list">
          <li>
            <NavItemLink item={DASHBOARD} collapsed={collapsed} className="nav-link nav-featured" />
          </li>
          <li role="separator" className="nav-separator" />
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavItemLink item={item} collapsed={collapsed} />
            </li>
          ))}
        </ul>
      </nav>
      <div className="sidebar-footer">
        <ThemeToggle />
      </div>
    </aside>
  );
}
