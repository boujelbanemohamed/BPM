import { NavLink, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  Bell,
  ClipboardList,
  Database,
  LayoutGrid,
  ListTree,
  LogOut,
  PlayCircle,
  ScrollText,
  UserCog,
  Users,
  Workflow,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'
  }`;

export function Layout() {
  const { user, logout, isAdmin } = useAuth();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const { count } = await api.unreadCount();
        if (!cancelled) setUnread(count);
      } catch {
        /* silencieux : le badge n'est pas critique */
      }
    }
    poll();
    const interval = setInterval(poll, 20000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3 shadow-sm">
        <div className="flex items-center gap-6">
          <span className="flex items-center gap-2 text-lg font-bold text-brand-700">
            <Workflow size={22} /> BPM Platform
          </span>
          <nav className="flex items-center gap-1">
            <NavLink to="/processes" className={navLinkClass}>
              <LayoutGrid size={16} /> Processus
            </NavLink>
            <NavLink to="/tasks" className={navLinkClass}>
              <ClipboardList size={16} /> Mes tâches
            </NavLink>
            <NavLink to="/instances" className={navLinkClass}>
              <PlayCircle size={16} /> Instances
            </NavLink>
            <NavLink to="/clients" className={navLinkClass}>
              <Users size={16} /> Clients
            </NavLink>
            {isAdmin && (
              <>
                <NavLink to="/admin/users" className={navLinkClass}>
                  <UserCog size={16} /> Utilisateurs
                </NavLink>
                <NavLink to="/admin/audit" className={navLinkClass}>
                  <ScrollText size={16} /> Audit
                </NavLink>
                <NavLink to="/admin/fields" className={navLinkClass}>
                  <ListTree size={16} /> Champs
                </NavLink>
                <NavLink to="/admin/database" className={navLinkClass}>
                  <Database size={16} /> Base de données
                </NavLink>
              </>
            )}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <NavLink to="/notifications" className="relative rounded-full p-2 text-slate-500 hover:bg-slate-100">
            <Bell size={20} />
            {unread > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </NavLink>
          <NavLink to="/profile" className="flex items-center gap-2 text-sm text-slate-600 hover:text-brand-700">
            {user?.avatarUrl ? (
              <img src={user.avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
            ) : (
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
                {(user?.firstName?.[0] ?? user?.fullName?.[0] ?? '?').toUpperCase()}
              </span>
            )}
            <span>
              {user?.fullName} <span className="text-slate-400">· {user?.roles.join(', ')}</span>
            </span>
          </NavLink>
          <button
            onClick={logout}
            className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
          >
            <LogOut size={16} /> Déconnexion
          </button>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
