import { FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, KeyRound, Workflow } from 'lucide-react';
import { api } from '../api/client';

export function ResetPasswordPage() {
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
      setError('Les deux mots de passe ne correspondent pas');
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
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-2 text-brand-700">
          <Workflow size={26} />
          <h1 className="text-xl font-bold">BPM Platform</h1>
        </div>

        {!token ? (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            Lien de réinitialisation invalide : le jeton est manquant dans l'URL.
          </p>
        ) : done ? (
          <div className="text-center">
            <CheckCircle2 size={32} className="mx-auto mb-3 text-emerald-600" />
            <p className="mb-1 font-semibold text-slate-800">Mot de passe modifié</p>
            <p className="mb-6 text-sm text-slate-500">Vous pouvez maintenant vous connecter avec votre nouveau mot de passe.</p>
            <button onClick={() => navigate('/login')} className="btn-primary w-full justify-center">
              Aller à la connexion
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit}>
            <p className="mb-4 flex items-center gap-2 text-sm text-slate-500">
              <KeyRound size={16} className="text-slate-400" /> Choisissez un nouveau mot de passe.
            </p>
            <div className="mb-4">
              <label className="mb-1 block text-sm font-medium text-slate-600">Nouveau mot de passe</label>
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
              <label className="mb-1 block text-sm font-medium text-slate-600">Confirmer le mot de passe</label>
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
              {busy ? 'Enregistrement…' : 'Choisir ce mot de passe'}
            </button>
            <Link
              to="/login"
              className="mt-4 block text-center text-xs font-medium text-slate-500 hover:text-brand-600"
            >
              Retour à la connexion
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
