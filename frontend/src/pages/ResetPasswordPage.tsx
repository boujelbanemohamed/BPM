import { FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, KeyRound, Workflow } from 'lucide-react';
import { api } from '../api/client';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError(t('auth.passwordMismatch'));
      return;
    }
    setBusy(true);
    try {
      await api.resetPassword(token, newPassword);
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-slate-50">
      <div className="absolute right-4 top-4">
        <LanguageSwitcher />
      </div>
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-2 text-brand-700">
          <Workflow size={26} />
          <h1 className="text-xl font-bold">{t('common.appName')}</h1>
        </div>

        {!token ? (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{t('auth.invalidResetLink')}</p>
        ) : done ? (
          <div className="text-center">
            <CheckCircle2 size={32} className="mx-auto mb-3 text-emerald-600" />
            <p className="mb-1 font-semibold text-slate-800">{t('auth.passwordChanged')}</p>
            <p className="mb-6 text-sm text-slate-500">{t('auth.passwordChangedMessage')}</p>
            <button onClick={() => navigate('/login')} className="btn-primary w-full justify-center">
              {t('auth.goToLogin')}
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit}>
            <p className="mb-4 flex items-center gap-2 text-sm text-slate-500">
              <KeyRound size={16} className="text-slate-400" /> {t('auth.chooseNewPassword')}
            </p>
            <div className="mb-4">
              <label className="mb-1 block text-sm font-medium text-slate-600">{t('auth.newPassword')}</label>
              <input
                type="password"
                autoFocus
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
              />
            </div>
            <div className="mb-5">
              <label className="mb-1 block text-sm font-medium text-slate-600">{t('auth.confirmPassword')}</label>
              <input
                type="password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
              />
            </div>
            {error && <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {busy ? t('auth.saving') : t('auth.chooseThisPassword')}
            </button>
            <Link
              to="/login"
              className="mt-4 block text-center text-xs font-medium text-slate-500 hover:text-brand-600"
            >
              {t('auth.backToLogin')}
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
