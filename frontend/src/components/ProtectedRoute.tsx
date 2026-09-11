import { Navigate } from 'react-router-dom';
import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { PageAccessLevel, PageKey } from '../types';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  if (loading) return <div className="flex h-screen items-center justify-center text-slate-400">{t('designer.loading')}</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function AdminRoute({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { user, loading, isAdmin } = useAuth();
  if (loading) return <div className="flex h-screen items-center justify-center text-slate-400">{t('designer.loading')}</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Réservée à ADMIN, ou à tout rôle auquel un administrateur a octroyé au
 * moins `minLevel` sur `pageKey` (voir Configuration → Rôles). */
export function RequirePageAccess({
  pageKey,
  minLevel,
  children,
}: {
  pageKey: PageKey;
  minLevel: PageAccessLevel;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { user, loading, hasAccess } = useAuth();
  if (loading) return <div className="flex h-screen items-center justify-center text-slate-400">{t('designer.loading')}</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!hasAccess(pageKey, minLevel)) return <Navigate to="/" replace />;
  return <>{children}</>;
}
