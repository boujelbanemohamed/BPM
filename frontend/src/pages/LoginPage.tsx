import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LogIn, ShieldCheck, Workflow } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

export function LoginPage() {
  const { t } = useTranslation();
  const { login, verifyTwoFactor } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('admin@bpm.local');
  const [password, setPassword] = useState('Admin123!');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [code, setCode] = useState('');

  async function onSubmitPassword(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await login(email, password);
      if (result.requiresTwoFactor && result.pendingToken) {
        setPendingToken(result.pendingToken);
      } else {
        navigate('/processes');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitCode(e: FormEvent) {
    e.preventDefault();
    if (!pendingToken) return;
    setError(null);
    setBusy(true);
    try {
      await verifyTwoFactor(pendingToken, code.trim());
      navigate('/processes');
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
      {!pendingToken ? (
        <form onSubmit={onSubmitPassword} className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="mb-6 flex items-center gap-2 text-brand-700">
            <Workflow size={26} />
            <h1 className="text-xl font-bold">{t('common.appName')}</h1>
          </div>
          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium text-slate-600">{t('auth.email')}</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
            />
          </div>
          <div className="mb-2">
            <label className="mb-1 block text-sm font-medium text-slate-600">{t('auth.password')}</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
            />
          </div>
          <div className="mb-5 text-right">
            <Link to="/forgot-password" className="text-xs font-medium text-brand-600 hover:underline">
              {t('auth.forgotPassword')}
            </Link>
          </div>
          {error && <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            <LogIn size={16} /> {busy ? t('auth.loggingIn') : t('auth.login')}
          </button>
          <p className="mt-5 text-center text-xs text-slate-400">{t('auth.demoAccounts')}</p>
        </form>
      ) : (
        <form onSubmit={onSubmitCode} className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="mb-6 flex items-center gap-2 text-brand-700">
            <ShieldCheck size={26} />
            <h1 className="text-xl font-bold">{t('auth.twoFactorTitle')}</h1>
          </div>
          <p className="mb-4 text-sm text-slate-500">{t('auth.twoFactorInstructions')}</p>
          <div className="mb-5">
            <label className="mb-1 block text-sm font-medium text-slate-600">{t('auth.code')}</label>
            <input
              autoFocus
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-center font-mono text-lg tracking-widest focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
              placeholder="123456"
            />
          </div>
          {error && <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            <ShieldCheck size={16} /> {busy ? t('auth.verifying') : t('auth.verify')}
          </button>
          <button
            type="button"
            onClick={() => {
              setPendingToken(null);
              setCode('');
              setError(null);
            }}
            className="mt-3 w-full text-center text-xs font-medium text-slate-500 hover:text-brand-600"
          >
            {t('auth.back')}
          </button>
        </form>
      )}
    </div>
  );
}
