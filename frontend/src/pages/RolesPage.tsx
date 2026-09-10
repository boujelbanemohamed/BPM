import { FormEvent, useEffect, useState } from 'react';
import { ClipboardList, KeyRound, Lock, PencilLine, PlusCircle, Shield, Users, X } from 'lucide-react';
import { api } from '../api/client';
import { RoleWithUsers } from '../types';

const ADMIN_ACCESS = [
  {
    label: 'Gestion des utilisateurs',
    detail: 'créer/modifier/désactiver des comptes, réinitialiser un mot de passe',
    path: '/admin/users',
  },
  {
    label: 'Conception des processus',
    detail: 'créer un processus, éditer son BPMN, le publier',
    path: '/processes',
  },
  {
    label: 'Matrice de droits',
    detail: 'définir qui voit/modifie quel champ à quelle étape',
    path: '/processes/:id/permissions',
  },
  {
    label: 'Le menu Configuration en entier',
    detail: 'Notifications (SMTP + modèles email), Base de données, Audit, Rôles, Utilisateurs',
    path: null,
  },
  {
    label: "L'onglet Champs",
    detail: 'registre de tous les champs de formulaire',
    path: '/admin/fields',
  },
];

const STANDARD_ACCESS = [
  'Démarrer un processus et traiter les tâches qui lui sont assignées',
  'Consulter la liste des instances de processus',
  'Gérer le module Clients (créer, consulter, modifier)',
  'Gérer son propre profil : nom, téléphone, avatar, mot de passe, préférence de notifications email, suppléants',
];

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

            <div className="mt-3 border-t border-slate-100 pt-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase text-slate-400">
                <KeyRound size={13} /> Accès
              </p>

              {role.name === 'ADMIN' && (
                <div className="mb-3">
                  <p className="mb-1 text-xs font-medium text-slate-400">Exclusif à ADMIN</p>
                  <ul className="space-y-1.5">
                    {ADMIN_ACCESS.map((item) => (
                      <li key={item.label} className="text-sm text-slate-600">
                        <span className="font-medium text-slate-700">{item.label}</span> : {item.detail}
                        {item.path && (
                          <code className="ml-1.5 rounded bg-slate-100 px-1 py-0.5 text-xs text-slate-400">{item.path}</code>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mb-3">
                <p className="mb-1 text-xs font-medium text-slate-400">Accès standard (tout utilisateur connecté)</p>
                <ul className="space-y-1.5">
                  {STANDARD_ACCESS.map((item) => (
                    <li key={item} className="text-sm text-slate-600">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-500">
                    <ClipboardList size={13} /> Tâches BPMN assignées à ce rôle
                  </p>
                  {role.assignedTasks.length === 0 ? (
                    <p className="text-xs text-slate-400">Aucune tâche assignée à ce rôle pour l'instant.</p>
                  ) : (
                    <ul className="space-y-1">
                      {role.assignedTasks.map((t, i) => (
                        <li key={i} className="text-xs text-slate-600">
                          <span className="font-medium">{t.processName}</span> → {t.stepName}
                          {t.processStatus !== 'PUBLISHED' && (
                            <span className="ml-1 text-slate-400">({t.processStatus.toLowerCase()})</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-500">
                    <Lock size={13} /> Règles de droits définies
                  </p>
                  {role.permissionRules.length === 0 ? (
                    <p className="text-xs text-slate-400">
                      Aucune règle spécifique : accès par défaut aux champs et documents de son étape.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {role.permissionRules.map((r, i) => (
                        <li key={i} className="text-xs text-slate-600">
                          <span className="font-medium">{r.processName}</span> → {r.stepName} — {r.fieldCount} champ
                          {r.fieldCount > 1 ? 's' : ''} configuré{r.fieldCount > 1 ? 's' : ''}, documents :{' '}
                          {r.canUploadDocuments ? 'dépôt autorisé' : r.canViewDocuments ? 'consultation' : 'aucun accès'}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
        {roles.length === 0 && <div className="card text-center text-slate-400">Chargement…</div>}
      </div>
    </div>
  );
}
