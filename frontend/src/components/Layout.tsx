import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bell,
  ChevronDown,
  ClipboardList,
  Database,
  FolderOpen,
  LayoutDashboard,
  LayoutGrid,
  ListTree,
  LogOut,
  Mail,
  PlayCircle,
  ScrollText,
  Settings,
  Shield,
  User,
  UserCog,
  Users,
  Workflow,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { PageAccessLevel, PageKey, PublicUser } from '../types';
import { SearchBox } from './SearchBox';
import { LanguageSwitcher } from './LanguageSwitcher';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors ${
    isActive ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'
  }`;

const dropdownLinkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'
  }`;

function useConfigItems(): { path: string; pageKey: PageKey; label: string; icon: typeof Mail }[] {
  const { t } = useTranslation();
  return [
    { path: '/admin/notifications', pageKey: 'NOTIFICATIONS_CONFIG', label: t('common.nav.notifications'), icon: Mail },
    { path: '/admin/database', pageKey: 'DATABASE', label: t('common.nav.database'), icon: Database },
    { path: '/admin/audit', pageKey: 'AUDIT', label: t('common.nav.audit'), icon: ScrollText },
    { path: '/admin/roles', pageKey: 'ROLES', label: t('common.nav.roles'), icon: Shield },
    { path: '/admin/users', pageKey: 'USERS', label: t('common.nav.users'), icon: UserCog },
  ];
}

function ConfigMenu({ hasAccess }: { hasAccess: (pageKey: PageKey, minLevel: PageAccessLevel) => boolean }) {
  const { t } = useTranslation();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const configItems = useConfigItems();
  const visibleItems = configItems.filter((item) => hasAccess(item.pageKey, 'VIEW'));
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
        title={t('common.nav.configuration')}
        className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors ${
          isActive ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'
        }`}
      >
        <Settings size={16} /> <span className="hidden 2xl:inline">{t('common.nav.configuration')}</span>
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

function ProfileMenu({ user, logout }: { user: PublicUser | null; logout: () => void }) {
  const { t } = useTranslation();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-sm text-slate-600 hover:bg-slate-100"
      >
        {user?.avatarUrl ? (
          <img src={user.avatarUrl} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
        ) : (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
            {(user?.firstName?.[0] ?? user?.fullName?.[0] ?? '?').toUpperCase()}
          </span>
        )}
        <span className="hidden w-16 flex-col items-start leading-tight md:flex">
          <span className="w-full truncate font-medium text-slate-700">{user?.firstName || user?.fullName}</span>
          {user?.lastName && <span className="w-full truncate text-xs text-slate-400">{user.lastName}</span>}
        </span>
        <ChevronDown size={14} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-10 mt-1 w-56 space-y-0.5 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
          <div className="border-b border-slate-100 px-3 py-2">
            <p className="truncate text-sm font-semibold text-slate-700">{user?.fullName}</p>
            <p className="truncate text-xs text-slate-400">{user?.roles.join(', ')}</p>
          </div>
          <NavLink to="/profile" className={dropdownLinkClass}>
            <User size={16} /> {t('profile.title')}
          </NavLink>
          <button
            onClick={logout}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100"
          >
            <LogOut size={16} /> {t('common.nav.logout')}
          </button>
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const { t } = useTranslation();
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
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5 shadow-sm">
        <span className="flex shrink-0 items-center gap-1.5 text-lg font-bold text-brand-700">
          <Workflow size={22} /> {t('common.appName')}
        </span>
        <nav className="scrollbar-hide flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          <NavLink to="/dashboard" className={navLinkClass} title={t('common.nav.dashboard')}>
            <LayoutDashboard size={16} /> <span className="hidden 2xl:inline">{t('common.nav.dashboard')}</span>
          </NavLink>
          <NavLink to="/processes" className={navLinkClass} title={t('common.nav.processes')}>
            <LayoutGrid size={16} /> <span className="hidden 2xl:inline">{t('common.nav.processes')}</span>
          </NavLink>
          <NavLink to="/tasks" className={navLinkClass} title={t('common.nav.myTasks')}>
            <ClipboardList size={16} /> <span className="hidden 2xl:inline">{t('common.nav.myTasks')}</span>
          </NavLink>
          <NavLink to="/instances" className={navLinkClass} title={t('common.nav.instances')}>
            <PlayCircle size={16} /> <span className="hidden 2xl:inline">{t('common.nav.instances')}</span>
          </NavLink>
          <NavLink to="/clients" className={navLinkClass} title={t('common.nav.clients')}>
            <Users size={16} /> <span className="hidden 2xl:inline">{t('common.nav.clients')}</span>
          </NavLink>
          {hasAccess('DOCUMENTS', 'VIEW') && (
            <NavLink to="/documents" className={navLinkClass} title={t('common.nav.documents')}>
              <FolderOpen size={16} /> <span className="hidden 2xl:inline">{t('common.nav.documents')}</span>
            </NavLink>
          )}
          {hasAccess('FIELDS_REGISTRY', 'VIEW') && (
            <NavLink to="/admin/fields" className={navLinkClass} title={t('common.nav.fields')}>
              <ListTree size={16} /> <span className="hidden 2xl:inline">{t('common.nav.fields')}</span>
            </NavLink>
          )}
          <ConfigMenu hasAccess={hasAccess} />
        </nav>
        <div className="flex shrink-0 items-center gap-2">
          <LanguageSwitcher />
          <SearchBox />
          <NavLink to="/notifications" className="relative shrink-0 rounded-full p-2 text-slate-500 hover:bg-slate-100">
            <Bell size={20} />
            {unread > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </NavLink>
          <ProfileMenu user={user} logout={logout} />
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
