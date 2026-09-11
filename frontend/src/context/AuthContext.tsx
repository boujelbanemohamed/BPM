import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { api, clearSession, getToken, storeSession } from '../api/client';
import { PageAccessLevel, PageKey, PublicUser } from '../types';

const LEVEL_RANK: Record<PageAccessLevel, number> = { NONE: 0, VIEW: 1, FULL: 2 };
const EMPTY_ACCESS = {} as Record<PageKey, PageAccessLevel>;

interface AuthContextValue {
  user: PublicUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ requiresTwoFactor: boolean; pendingToken?: string }>;
  verifyTwoFactor: (pendingToken: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  isAdmin: boolean;
  pageAccess: Record<PageKey, PageAccessLevel>;
  hasAccess: (pageKey: PageKey, minLevel: PageAccessLevel) => boolean;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [pageAccess, setPageAccess] = useState<Record<PageKey, PageAccessLevel>>(EMPTY_ACCESS);
  const [loading, setLoading] = useState(true);

  async function refreshUser() {
    if (!getToken()) {
      setUser(null);
      setPageAccess(EMPTY_ACCESS);
      return;
    }
    try {
      const { user, pageAccess } = await api.me();
      setUser(user);
      setPageAccess(pageAccess);
    } catch {
      clearSession();
      setUser(null);
      setPageAccess(EMPTY_ACCESS);
    }
  }

  useEffect(() => {
    refreshUser().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function login(email: string, password: string) {
    const result = await api.login(email, password);
    if (result.requiresTwoFactor) {
      return { requiresTwoFactor: true, pendingToken: result.pendingToken };
    }
    storeSession({ token: result.token, refreshToken: result.refreshToken });
    setUser(result.user);
    setPageAccess(result.pageAccess);
    return { requiresTwoFactor: false };
  }

  async function verifyTwoFactor(pendingToken: string, code: string) {
    const { token, refreshToken, user, pageAccess } = await api.verifyTwoFactorLogin(pendingToken, code);
    storeSession({ token, refreshToken });
    setUser(user);
    setPageAccess(pageAccess);
  }

  async function logout() {
    await api.logout();
    clearSession();
    setUser(null);
    setPageAccess(EMPTY_ACCESS);
  }

  const isAdmin = user?.roles.includes('ADMIN') ?? false;

  function hasAccess(pageKey: PageKey, minLevel: PageAccessLevel): boolean {
    if (isAdmin) return true;
    const level = pageAccess[pageKey] ?? 'NONE';
    return LEVEL_RANK[level] >= LEVEL_RANK[minLevel];
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, login, verifyTwoFactor, logout, isAdmin, pageAccess, hasAccess, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé à l\'intérieur de AuthProvider');
  return ctx;
}
