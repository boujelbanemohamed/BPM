import { FormEvent, useEffect, useState } from 'react';
import { KeyRound, Save, Users } from 'lucide-react';
import { api } from '../api/client';
import { MinimalUser, PublicUser } from '../types';
import { useAuth } from '../context/AuthContext';

export function ProfilePage() {
  const { user } = useAuth();
  const [delegation, setDelegation] = useState<PublicUser | null>(null);
  const [users, setUsers] = useState<MinimalUser[]>([]);
  const [delegate1, setDelegate1] = useState('');
  const [delegate2, setDelegate2] = useState('');
  const [absenceStart, setAbsenceStart] = useState('');
  const [absenceEnd, setAbsenceEnd] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwStatus, setPwStatus] = useState<string | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);

  useEffect(() => {
    api.getMyDelegation().then(({ delegation }) => {
      setDelegation(delegation);
      setDelegate1(delegation.delegateUser1Id ?? '');
      setDelegate2(delegation.delegateUser2Id ?? '');
      setAbsenceStart(delegation.absenceStart ?? '');
      setAbsenceEnd(delegation.absenceEnd ?? '');
    });
    api.listUsersMinimal().then(({ users }) => setUsers(users));
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus('Enregistrement…');
    try {
      const { delegation } = await api.updateMyDelegation({
        delegateUser1Id: delegate1 || null,
        delegateUser2Id: delegate2 || null,
        absenceStart: absenceStart || null,
        absenceEnd: absenceEnd || null,
      });
      setDelegation(delegation);
      setStatus('Enregistré');
      setTimeout(() => setStatus(null), 1500);
    } catch (err) {
      setError((err as Error).message);
      setStatus(null);
    }
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setPwError(null);
    setPwStatus('Enregistrement…');
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setPwStatus('Mot de passe modifié');
      setTimeout(() => setPwStatus(null), 1500);
    } catch (err) {
      setPwError((err as Error).message);
      setPwStatus(null);
    }
  }

  if (!delegation) return <div className="p-6 text-slate-400">Chargement…</div>;

  const otherUsers = users.filter((u) => u.id !== user?.id);

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-bold text-slate-800">Mon profil</h1>

      <form onSubmit={save} className="card space-y-4">
        <h2 className="flex items-center gap-2 font-semibold text-slate-700">
          <Users size={18} /> Mes délégations &amp; congés
        </h2>
        <p className="text-sm text-slate-500">
          Si votre compte est désactivé ou que vous êtes en congé sur la période ci-dessous, vos tâches en attente
          seront automatiquement réassignées à votre Suppléant 1, puis à votre Suppléant 2 si celui-ci est
          également indisponible.
        </p>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Suppléant 1 (prioritaire)</span>
          <select className="input" value={delegate1} onChange={(e) => setDelegate1(e.target.value)}>
            <option value="">— aucun —</option>
            {otherUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName} ({u.roles.join(', ')})
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Suppléant 2 (backup secondaire)</span>
          <select className="input" value={delegate2} onChange={(e) => setDelegate2(e.target.value)}>
            <option value="">— aucun —</option>
            {otherUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName} ({u.roles.join(', ')})
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Début de congé</span>
            <input type="date" className="input" value={absenceStart} onChange={(e) => setAbsenceStart(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Fin de congé</span>
            <input type="date" className="input" value={absenceEnd} onChange={(e) => setAbsenceEnd(e.target.value)} />
          </label>
        </div>

        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <div className="flex items-center gap-3">
          <button type="submit" className="btn-primary">
            <Save size={16} /> Enregistrer
          </button>
          {status && <span className="text-sm text-slate-400">{status}</span>}
        </div>
      </form>

      <form onSubmit={changePassword} className="card space-y-4">
        <h2 className="flex items-center gap-2 font-semibold text-slate-700">
          <KeyRound size={18} /> Changer mon mot de passe
        </h2>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Mot de passe actuel</span>
          <input
            type="password"
            required
            className="input"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Nouveau mot de passe (8 caractères min.)</span>
          <input
            type="password"
            required
            minLength={8}
            className="input"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </label>
        {pwError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{pwError}</p>}
        <div className="flex items-center gap-3">
          <button type="submit" className="btn-primary">
            <Save size={16} /> Mettre à jour
          </button>
          {pwStatus && <span className="text-sm text-slate-400">{pwStatus}</span>}
        </div>
      </form>
    </div>
  );
}
