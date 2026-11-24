import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import ChangesPage from "./pages/ChangesPage";
import DashboardPage from "./pages/DashboardPage";
import InventoryPage from "./pages/InventoryPage";
import ProductsPage from "./pages/ProductsPage";
import ProjectSupplyDetailPage from "./pages/ProjectSupplyDetailPage";
import RulesPage from "./pages/RulesPage";
import SegmentsPage from "./pages/SegmentsPage";
import SharePage from "./pages/SharePage";
import ShareRecordsPage from "./pages/ShareRecordsPage";
import SupplyDemandPage from "./pages/SupplyDemandPage";
import SupplierMasterPage from "./pages/SupplierMasterPage";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Toaster } from "@/components/ui/sonner";

/**
 * 每个路由各包一层错误边界：一页渲染崩了不影响其他页，
 * key 用 pathname 保证切页时自动复位（否则报错后跳到别的页仍然是错误页）。
 */
function RoutedApp() {
  const location = useLocation();
  return (
    <ErrorBoundary key={location.pathname} label={location.pathname}>
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
        <Route path="/changes" element={<ChangesPage />} />
        <Route path="/segments" element={<SegmentsPage />} />
        <Route path="/rules" element={<RulesPage />} />
        {/* 旧项目页已并入供应管理 */}
        <Route path="/projects" element={<Navigate to="/materials" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}

export default function App() {
  return (
    <>
      <RoutedApp />
      <Toaster richColors position="top-right" />
    </>
  );
}
