import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import {
  Bell,
  ChevronDown,
  ClipboardList,
  Database,
  LayoutGrid,
  ListTree,
  LogOut,
  Mail,
  PlayCircle,
  ScrollText,
  Settings,
  Shield,
  UserCog,
  Users,
  Workflow,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { PageAccessLevel, PageKey } from '../types';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'
  }`;

const dropdownLinkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'
  }`;

const CONFIG_ITEMS: { path: string; pageKey: PageKey; label: string; icon: typeof Mail }[] = [
  { path: '/admin/notifications', pageKey: 'NOTIFICATIONS_CONFIG', label: 'Notifications', icon: Mail },
  { path: '/admin/database', pageKey: 'DATABASE', label: 'Base de données', icon: Database },
  { path: '/admin/audit', pageKey: 'AUDIT', label: 'Audit', icon: ScrollText },
  { path: '/admin/roles', pageKey: 'ROLES', label: 'Rôles', icon: Shield },
  { path: '/admin/users', pageKey: 'USERS', label: 'Utilisateurs', icon: UserCog },
];

function ConfigMenu({ hasAccess }: { hasAccess: (pageKey: PageKey, minLevel: PageAccessLevel) => boolean }) {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const visibleItems = CONFIG_ITEMS.filter((item) => hasAccess(item.pageKey, 'VIEW'));
  const isActive = visibleItems.some((item) => location.pathname.startsWith(item.path));

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  if (visibleItems.length === 0) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          isActive ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'
        }`}
      >
        <Settings size={16} /> Configuration
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-10 mt-1 w-56 space-y-0.5 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
          {visibleItems.map((item) => (
            <NavLink key={item.path} to={item.path} className={dropdownLinkClass}>
              <item.icon size={16} /> {item.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const { user, logout, hasAccess } = useAuth();
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
            {hasAccess('FIELDS_REGISTRY', 'VIEW') && (
              <NavLink to="/admin/fields" className={navLinkClass}>
                <ListTree size={16} /> Champs
              </NavLink>
            )}
            <ConfigMenu hasAccess={hasAccess} />
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
