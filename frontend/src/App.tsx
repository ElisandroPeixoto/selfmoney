import { Navigate, Route, Routes } from "react-router-dom";

import type { AuthStatus } from "./api/client";
import AuthGate from "./auth/AuthGate";
import Sidebar from "./components/Sidebar";
import Accounts from "./pages/Accounts";
import Budgets from "./pages/Budgets";
import Categories from "./pages/Categories";
import CreditCards from "./pages/CreditCards";
import Dashboard from "./pages/Dashboard";
import Movements from "./pages/Movements";
import Reports from "./pages/Reports";
import Transactions from "./pages/Transactions";

export default function App({ authStatus }: { authStatus: AuthStatus }) {
  return (
    <AuthGate initialStatus={authStatus}>
      <div className="layout">
        <Sidebar />
        <main className="content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/contas" element={<Accounts />} />
            <Route path="/movimentacoes" element={<Movements />} />
            <Route path="/categorias" element={<Categories />} />
            <Route path="/lancamentos" element={<Transactions />} />
            <Route path="/orcamentos" element={<Budgets />} />
            <Route path="/orcamentos/:budgetId" element={<Budgets />} />
            <Route path="/relatorios" element={<Reports />} />
            <Route path="/cartoes" element={<CreditCards />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </AuthGate>
  );
}
