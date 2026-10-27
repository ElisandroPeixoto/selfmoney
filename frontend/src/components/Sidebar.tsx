import { useEffect, useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";

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

const NAV_ITEMS: { to: string; label: string; icon: ReactNode; end?: boolean }[] = [
  { to: "/", label: "Dashboard", icon: <DashboardIcon /> },
  { to: "/lancamentos", label: "Lançamentos", icon: <ListIcon /> },
  { to: "/orcamentos", label: "Orçamentos", icon: <BudgetIcon />, end: false },
  { to: "/movimentacoes", label: "Movimentações", icon: <TransferIcon /> },
  { to: "/contas", label: "Contas", icon: <WalletIcon /> },
  { to: "/categorias", label: "Categorias", icon: <TagIcon /> },
];

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(readCollapsed);

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
        <span className="brand">{collapsed ? "S" : "SelfMoney"}</span>
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
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end ?? true}
                className="nav-link"
                title={collapsed ? item.label : undefined}
                aria-label={collapsed ? item.label : undefined}
              >
                {item.icon}
                <span className="sidebar-label">{item.label}</span>
              </NavLink>
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
