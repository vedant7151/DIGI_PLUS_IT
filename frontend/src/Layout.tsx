import { NavLink, Outlet } from "react-router-dom";

const link = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-1.5 text-sm ${isActive ? "bg-sky-500 text-white" : "text-slate-300 hover:bg-slate-800"}`;

export default function Layout() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <NavLink to="/" className="font-semibold tracking-tight">
            🛠️ AI Service Desk
          </NavLink>
          <nav className="flex gap-2">
            <NavLink to="/" className={link} end>
              Incidents
            </NavLink>
            <NavLink to="/new" className={link}>
              New
            </NavLink>
            <NavLink to="/analytics" className={link}>
              Analytics
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
