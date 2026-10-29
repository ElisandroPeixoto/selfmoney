import { Navigate, Route, Routes } from "react-router-dom";

import Sidebar from "./components/Sidebar";
import Accounts from "./pages/Accounts";
import Budgets from "./pages/Budgets";
import Categories from "./pages/Categories";
import Dashboard from "./pages/Dashboard";
import Movements from "./pages/Movements";
import Reports from "./pages/Reports";
import Transactions from "./pages/Transactions";

export default function App() {
  return (
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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
