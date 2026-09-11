import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LogIn, ShieldCheck, Workflow } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export function LoginPage() {
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
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      {!pendingToken ? (
        <form onSubmit={onSubmitPassword} className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="mb-6 flex items-center gap-2 text-brand-700">
            <Workflow size={26} />
            <h1 className="text-xl font-bold">BPM Platform</h1>
          </div>
          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium text-slate-600">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
            />
          </div>
          <div className="mb-2">
            <label className="mb-1 block text-sm font-medium text-slate-600">Mot de passe</label>
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
              Mot de passe oublié ?
            </Link>
          </div>
          {error && <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            <LogIn size={16} /> {busy ? 'Connexion…' : 'Se connecter'}
          </button>
          <p className="mt-5 text-center text-xs text-slate-400">
            Comptes de démo (mot de passe Admin123!) : admin@bpm.local · validator@bpm.local · operator@bpm.local
          </p>
        </form>
      ) : (
        <form onSubmit={onSubmitCode} className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="mb-6 flex items-center gap-2 text-brand-700">
            <ShieldCheck size={26} />
            <h1 className="text-xl font-bold">Vérification en deux étapes</h1>
          </div>
          <p className="mb-4 text-sm text-slate-500">
            Saisissez le code à 6 chiffres de votre application d'authentification, ou l'un de vos codes de secours.
          </p>
          <div className="mb-5">
            <label className="mb-1 block text-sm font-medium text-slate-600">Code</label>
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
            <ShieldCheck size={16} /> {busy ? 'Vérification…' : 'Vérifier'}
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
            Retour
          </button>
        </form>
      )}
    </div>
  );
}
