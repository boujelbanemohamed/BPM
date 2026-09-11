import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, MailCheck, Workflow } from 'lucide-react';
import { api } from '../api/client';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.forgotPassword(email.trim());
      setSent(true);
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

        {sent ? (
          <div className="text-center">
            <MailCheck size={32} className="mx-auto mb-3 text-emerald-600" />
            <p className="mb-1 font-semibold text-slate-800">Email envoyé</p>
            <p className="mb-6 text-sm text-slate-500">
              Si un compte existe avec cette adresse, un email contenant un lien de réinitialisation vient de vous être
              envoyé.
            </p>
            <Link to="/login" className="text-sm font-medium text-brand-600 hover:underline">
              Retour à la connexion
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit}>
            <p className="mb-4 text-sm text-slate-500">
              Saisissez votre adresse email : nous vous enverrons un lien pour choisir un nouveau mot de passe.
            </p>
            <div className="mb-5">
              <label className="mb-1 block text-sm font-medium text-slate-600">Email</label>
              <input
                type="email"
                autoFocus
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
              />
            </div>
            {error && <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {busy ? 'Envoi…' : 'Envoyer le lien'}
            </button>
            <Link
              to="/login"
              className="mt-4 flex items-center justify-center gap-1 text-xs font-medium text-slate-500 hover:text-brand-600"
            >
              <ArrowLeft size={12} /> Retour à la connexion
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
