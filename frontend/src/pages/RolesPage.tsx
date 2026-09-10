import { FormEvent, useEffect, useState } from 'react';
import { PencilLine, PlusCircle, Shield, Users, X } from 'lucide-react';
import { api } from '../api/client';
import { RoleWithUsers } from '../types';

export function RolesPage() {
  const [roles, setRoles] = useState<RoleWithUsers[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDescription, setEditDescription] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  function load() {
    api.listRolesOverview().then(({ roles }) => setRoles(roles));
  }

  useEffect(load, []);

  async function createRole(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    try {
      await api.createRole({ name: newName, description: newDescription || undefined });
      setCreating(false);
      setNewName('');
      setNewDescription('');
      load();
    } catch (err) {
      setCreateError((err as Error).message);
    }
  }

  function startEdit(role: RoleWithUsers) {
    setEditingId(role.id);
    setEditDescription(role.description ?? '');
    setEditError(null);
  }

  async function saveEdit(id: number) {
    setEditError(null);
    try {
      await api.updateRole(id, { description: editDescription || null });
      setEditingId(null);
      load();
    } catch (err) {
      setEditError((err as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-800">
          <Shield size={22} /> Rôles
        </h1>
        <button onClick={() => setCreating(true)} className="btn-primary">
          <PlusCircle size={16} /> Nouveau rôle
        </button>
      </div>

      <p className="mb-6 text-sm text-slate-500">
        Un rôle définit à qui une tâche BPMN peut être assignée et sert de clé dans la matrice de droits d'un
        processus. Le nom d'un rôle n'est pas modifiable une fois créé, car il est référencé tel quel dans les
        processus déjà conçus.
      </p>

      {creating && (
        <form onSubmit={createRole} className="card mb-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-700">Nouveau rôle</h2>
            <button type="button" onClick={() => setCreating(false)}>
              <X size={18} className="text-slate-400" />
            </button>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">
              Nom (lettres, chiffres, underscores — ex. JURISTE)
            </span>
            <input required className="input" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Description</span>
            <input className="input" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} />
          </label>
          {createError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{createError}</p>}
          <button type="submit" className="btn-primary">
            Créer le rôle
          </button>
        </form>
      )}

      <div className="space-y-4">
        {roles.map((role) => (
          <div key={role.id} className="card">
            <div className="mb-3 flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-brand-100 px-2.5 py-1 text-xs font-bold text-brand-700">
                    {role.name}
                  </span>
                  <span className="text-xs text-slate-400">
                    {role.users.length} utilisateur{role.users.length > 1 ? 's' : ''}
                  </span>
                </div>
                {editingId === role.id ? (
                  <div className="mt-2 space-y-2">
                    <input
                      className="input"
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      placeholder="Description du rôle"
                    />
                    {editError && <p className="text-sm text-rose-600">{editError}</p>}
                    <div className="flex items-center gap-2">
                      <button onClick={() => saveEdit(role.id)} className="btn-primary">
                        Enregistrer
                      </button>
                      <button onClick={() => setEditingId(null)} className="btn-secondary">
                        Annuler
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-1.5 text-sm text-slate-500">{role.description || <em>Aucune description</em>}</p>
                )}
              </div>
              {editingId !== role.id && (
                <button onClick={() => startEdit(role)} className="btn-secondary">
                  <PencilLine size={14} /> Modifier
                </button>
              )}
            </div>

            <div className="border-t border-slate-100 pt-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase text-slate-400">
                <Users size={13} /> Utilisateurs
              </p>
              {role.users.length === 0 ? (
                <p className="text-sm text-slate-400">Aucun utilisateur n'a ce rôle.</p>
              ) : (
                <ul className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
                  {role.users.map((u) => (
                    <li key={u.id} className="flex items-center gap-1.5 text-sm">
                      <span className={`h-1.5 w-1.5 rounded-full ${u.isActive ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                      <span className={u.isActive ? 'text-slate-700' : 'text-slate-400'}>{u.fullName}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ))}
        {roles.length === 0 && <div className="card text-center text-slate-400">Chargement…</div>}
      </div>
    </div>
  );
}
