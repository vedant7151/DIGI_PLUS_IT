import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Layout from "./Layout";
import AnalyticsPage from "./pages/AnalyticsPage";
import IncidentDetailPage from "./pages/IncidentDetailPage";
import IncidentListPage from "./pages/IncidentListPage";
import NewIncidentPage from "./pages/NewIncidentPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<IncidentListPage />} />
          <Route path="new" element={<NewIncidentPage />} />
          <Route path="incidents/:id" element={<IncidentDetailPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
