import { Navigate, Route, Routes } from "react-router-dom";
import DashboardPage from "./pages/DashboardPage";
import InventoryPage from "./pages/InventoryPage";
import ProductsPage from "./pages/ProductsPage";
import ProjectSupplyDetailPage from "./pages/ProjectSupplyDetailPage";
import RulesPage from "./pages/RulesPage";
import SharePage from "./pages/SharePage";
import ShareRecordsPage from "./pages/ShareRecordsPage";
import SupplyDemandPage from "./pages/SupplyDemandPage";
import SupplierMasterPage from "./pages/SupplierMasterPage";
import { Toaster } from "@/components/ui/sonner";

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/materials" element={<SupplierMasterPage />} />
        <Route path="/supply-demand" element={<SupplyDemandPage />} />
        <Route path="/supply-demand/projects/:projectId" element={<ProjectSupplyDetailPage />} />
        <Route path="/share" element={<SharePage />} />
        <Route path="/share/records" element={<ShareRecordsPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/rules" element={<RulesPage />} />
        {/* 旧项目页已并入供应管理 */}
        <Route path="/projects" element={<Navigate to="/materials" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
      <Toaster richColors position="top-right" />
    </>
  );
}
