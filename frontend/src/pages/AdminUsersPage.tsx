import { FormEvent, useEffect, useState } from 'react';
import { PlusCircle, PowerOff, Power, PencilLine, X } from 'lucide-react';
import { api } from '../api/client';
import { PublicUser, Role } from '../types';

interface FormState {
  id: string | null;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone: string;
  roleNames: string[];
  delegateUser1Id: string;
  delegateUser2Id: string;
  absenceStart: string;
  absenceEnd: string;
}

const EMPTY_FORM: FormState = {
  id: null,
  email: '',
  password: '',
  firstName: '',
  lastName: '',
  phone: '',
  roleNames: [],
  delegateUser1Id: '',
  delegateUser2Id: '',
  absenceStart: '',
  absenceEnd: '',
};

export function AdminUsersPage() {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function refresh() {
    const [usersRes, rolesRes] = await Promise.all([api.adminListUsers(), api.listRoles()]);
    setUsers(usersRes.users);
    setRoles(rolesRes.roles);
  }

  useEffect(() => {
    refresh();
  }, []);

  function openCreate() {
    setForm({ ...EMPTY_FORM });
    setError(null);
  }

  function openEdit(u: PublicUser) {
    setForm({
      id: u.id,
      email: u.email,
      password: '',
      firstName: u.firstName ?? '',
      lastName: u.lastName ?? '',
      phone: u.phone ?? '',
      roleNames: u.roles,
      delegateUser1Id: u.delegateUser1Id ?? '',
      delegateUser2Id: u.delegateUser2Id ?? '',
      absenceStart: u.absenceStart ?? '',
      absenceEnd: u.absenceEnd ?? '',
    });
    setError(null);
  }

  function toggleRole(name: string) {
    if (!form) return;
    setForm({
      ...form,
      roleNames: form.roleNames.includes(name) ? form.roleNames.filter((r) => r !== name) : [...form.roleNames, name],
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError(null);
    try {
      if (form.id) {
        await api.adminUpdateUser(form.id, {
          firstName: form.firstName,
          lastName: form.lastName,
          phone: form.phone || null,
          email: form.email,
          password: form.password || undefined,
          roleNames: form.roleNames,
          delegateUser1Id: form.delegateUser1Id || null,
          delegateUser2Id: form.delegateUser2Id || null,
          absenceStart: form.absenceStart || null,
          absenceEnd: form.absenceEnd || null,
        });
      } else {
        await api.adminCreateUser({
          email: form.email,
          password: form.password,
          firstName: form.firstName,
          lastName: form.lastName,
          phone: form.phone || null,
          roleNames: form.roleNames,
        });
      }
      setForm(null);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function deactivate(u: PublicUser) {
    if (!window.confirm(`Désactiver le compte de ${u.fullName} ? Ses tâches en attente seront réassignées à sa chaîne de suppléance.`))
      return;
    try {
      const { reassignedTasks } = await api.adminDeactivateUser(u.id);
      setInfo(`Compte désactivé. ${reassignedTasks} tâche(s) réassignée(s).`);
      setTimeout(() => setInfo(null), 3000);
      refresh();
    } catch (err) {
      window.alert((err as Error).message);
    }
  }

  async function activate(u: PublicUser) {
    try {
      await api.adminActivateUser(u.id);
      refresh();
    } catch (err) {
      window.alert((err as Error).message);
    }
  }

  const otherUsers = users.filter((u) => u.id !== form?.id);

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Administration des utilisateurs</h1>
        <button onClick={openCreate} className="btn-primary">
          <PlusCircle size={16} /> Nouvel utilisateur
        </button>
      </div>

      {info && <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{info}</p>}

      {form && (
        <form onSubmit={submit} className="card mb-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-700">{form.id ? 'Modifier l\'utilisateur' : 'Nouvel utilisateur'}</h2>
            <button type="button" onClick={() => setForm(null)}>
              <X size={18} className="text-slate-400" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Prénom</span>
              <input
                required
                className="input"
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Nom</span>
              <input
                required
                className="input"
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Téléphone</span>
              <input
                type="tel"
                className="input"
                placeholder="+33 6 12 34 56 78"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Email</span>
              <input
                type="email"
                required
                className="input"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">
              {form.id ? 'Mot de passe (8 caractères min., laisser vide pour ne pas le modifier)' : 'Mot de passe initial (8 caractères min.)'}
            </span>
            <input
              type="password"
              required={!form.id}
              minLength={8}
              className="input"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>

          <div>
            <span className="mb-1 block text-xs font-medium text-slate-500">Rôles</span>
            <div className="flex gap-4">
              {roles.map((r) => (
                <label key={r.id} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={form.roleNames.includes(r.name)} onChange={() => toggleRole(r.name)} />
                  {r.name}
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Suppléant 1</span>
              <select className="input" value={form.delegateUser1Id} onChange={(e) => setForm({ ...form, delegateUser1Id: e.target.value })}>
                <option value="">— aucun —</option>
                {otherUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Suppléant 2</span>
              <select className="input" value={form.delegateUser2Id} onChange={(e) => setForm({ ...form, delegateUser2Id: e.target.value })}>
                <option value="">— aucun —</option>
                {otherUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Début de congé</span>
              <input type="date" className="input" value={form.absenceStart} onChange={(e) => setForm({ ...form, absenceStart: e.target.value })} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Fin de congé</span>
              <input type="date" className="input" value={form.absenceEnd} onChange={(e) => setForm({ ...form, absenceEnd: e.target.value })} />
            </label>
          </div>

          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
          <button type="submit" className="btn-primary">
            {form.id ? 'Enregistrer' : 'Créer le compte'}
          </button>
        </form>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Nom</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Rôles</th>
              <th className="px-4 py-3">Statut</th>
              <th className="px-4 py-3">Suppléants</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-800">{u.fullName}</td>
                <td className="px-4 py-3 text-slate-500">{u.email}</td>
                <td className="px-4 py-3 text-slate-500">{u.roles.join(', ')}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      u.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'
                    }`}
                  >
                    {u.isActive ? 'Actif' : 'Désactivé'}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">
                  {users.find((x) => x.id === u.delegateUser1Id)?.fullName ?? '—'} /{' '}
                  {users.find((x) => x.id === u.delegateUser2Id)?.fullName ?? '—'}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <button onClick={() => openEdit(u)} className="btn-secondary">
                      <PencilLine size={14} /> Modifier
                    </button>
                    {u.isActive ? (
                      <button
                        onClick={() => deactivate(u)}
                        className="flex items-center gap-1 rounded-lg bg-rose-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
                      >
                        <PowerOff size={14} /> Désactiver
                      </button>
                    ) : (
                      <button
                        onClick={() => activate(u)}
                        className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                      >
                        <Power size={14} /> Réactiver
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
