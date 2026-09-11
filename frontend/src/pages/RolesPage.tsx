import { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardList, KeyRound, Lock, PencilLine, PlusCircle, Save, Shield, Users, X } from 'lucide-react';
import { api } from '../api/client';
import { PAGE_KEYS, PageAccessLevel, PageKey, RoleWithUsers } from '../types';
import { useAuth } from '../context/AuthContext';
import { processStatusLabel } from '../lib/processStatus';

const PAGE_LEVELS: Record<PageKey, PageAccessLevel[]> = {
  PROCESSES_DESIGN: ['NONE', 'VIEW', 'FULL'],
  PERMISSIONS_MATRIX: ['NONE', 'VIEW', 'FULL'],
  USERS: ['NONE', 'VIEW', 'FULL'],
  AUDIT: ['NONE', 'VIEW'],
  DATABASE: ['NONE', 'VIEW'],
  FIELDS_REGISTRY: ['NONE', 'VIEW'],
  NOTIFICATIONS_CONFIG: ['NONE', 'VIEW', 'FULL'],
  ROLES: ['NONE', 'VIEW', 'FULL'],
  DOCUMENTS: ['NONE', 'VIEW', 'FULL'],
};

const ADMIN_ACCESS_KEYS = ['users', 'processDesign', 'permissionsMatrix', 'configMenu', 'fieldsTab'] as const;
const ADMIN_ACCESS_PATHS: Record<(typeof ADMIN_ACCESS_KEYS)[number], string | null> = {
  users: '/admin/users',
  processDesign: '/processes',
  permissionsMatrix: '/processes/:id/permissions',
  configMenu: null,
  fieldsTab: '/admin/fields',
};

const STANDARD_ACCESS_KEYS = ['startProcess', 'viewInstances', 'manageClients', 'manageProfile'] as const;

export function RolesPage() {
  const { t } = useTranslation();
  const { hasAccess } = useAuth();
  const canManage = hasAccess('ROLES', 'FULL');
  const [roles, setRoles] = useState<RoleWithUsers[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDescription, setEditDescription] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  const [pageAccessDrafts, setPageAccessDrafts] = useState<Record<number, Record<PageKey, PageAccessLevel>>>({});
  const [accessStatus, setAccessStatus] = useState<Record<number, string | null>>({});
  const [accessError, setAccessError] = useState<Record<number, string | null>>({});

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

  function getAccessDraft(role: RoleWithUsers): Record<PageKey, PageAccessLevel> {
    return pageAccessDrafts[role.id] ?? role.pageAccess;
  }

  function setAccessLevel(role: RoleWithUsers, pageKey: PageKey, level: PageAccessLevel) {
    setPageAccessDrafts((prev) => ({
      ...prev,
      [role.id]: { ...getAccessDraft(role), [pageKey]: level },
    }));
  }

  async function saveAccess(role: RoleWithUsers) {
    setAccessError((prev) => ({ ...prev, [role.id]: null }));
    setAccessStatus((prev) => ({ ...prev, [role.id]: t('profile.saving') }));
    try {
      await api.updateRolePageAccess(role.id, getAccessDraft(role));
      setAccessStatus((prev) => ({ ...prev, [role.id]: t('profile.saved') }));
      load();
      setTimeout(() => setAccessStatus((prev) => ({ ...prev, [role.id]: null })), 1500);
    } catch (err) {
      setAccessError((prev) => ({ ...prev, [role.id]: (err as Error).message }));
      setAccessStatus((prev) => ({ ...prev, [role.id]: null }));
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-800">
          <Shield size={22} /> {t('roles.title')}
        </h1>
        {canManage && (
          <button onClick={() => setCreating(true)} className="btn-primary">
            <PlusCircle size={16} /> {t('roles.new')}
          </button>
        )}
      </div>

      <p className="mb-6 text-sm text-slate-500">{t('roles.description')}</p>

      {creating && canManage && (
        <form onSubmit={createRole} className="card mb-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-700">{t('roles.createForm.title')}</h2>
            <button type="button" onClick={() => setCreating(false)}>
              <X size={18} className="text-slate-400" />
            </button>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">{t('roles.createForm.namePattern')}</span>
            <input required className="input" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">{t('roles.createForm.description')}</span>
            <input className="input" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} />
          </label>
          {createError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{createError}</p>}
          <button type="submit" className="btn-primary">
            {t('roles.createForm.submit')}
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
                    {t('roles.userCount', { count: role.users.length })}
                  </span>
                </div>
                {editingId === role.id && canManage ? (
                  <div className="mt-2 space-y-2">
                    <input
                      className="input"
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      placeholder={t('roles.editDescriptionPlaceholder') as string}
                    />
                    {editError && <p className="text-sm text-rose-600">{editError}</p>}
                    <div className="flex items-center gap-2">
                      <button onClick={() => saveEdit(role.id)} className="btn-primary">
                        {t('roles.save')}
                      </button>
                      <button onClick={() => setEditingId(null)} className="btn-secondary">
                        {t('roles.cancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-1.5 text-sm text-slate-500">
                    {role.description || <em>{t('roles.noDescription')}</em>}
                  </p>
                )}
              </div>
              {editingId !== role.id && canManage && (
                <button onClick={() => startEdit(role)} className="btn-secondary">
                  <PencilLine size={14} /> {t('roles.edit')}
                </button>
              )}
            </div>

            <div className="border-t border-slate-100 pt-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase text-slate-400">
                <Users size={13} /> {t('roles.users')}
              </p>
              {role.users.length === 0 ? (
                <p className="text-sm text-slate-400">{t('roles.noUsers')}</p>
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
                <KeyRound size={13} /> {t('roles.access')}
              </p>

              {role.name === 'ADMIN' && (
                <div className="mb-3">
                  <p className="mb-1 text-xs font-medium text-slate-400">{t('roles.adminExclusive')}</p>
                  <ul className="space-y-1.5">
                    {ADMIN_ACCESS_KEYS.map((key) => (
                      <li key={key} className="text-sm text-slate-600">
                        <span className="font-medium text-slate-700">{t(`roles.adminAccess.${key}.label`)}</span> :{' '}
                        {t(`roles.adminAccess.${key}.detail`)}
                        {ADMIN_ACCESS_PATHS[key] && (
                          <code className="ml-1.5 rounded bg-slate-100 px-1 py-0.5 text-xs text-slate-400">
                            {ADMIN_ACCESS_PATHS[key]}
                          </code>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mb-3">
                <p className="mb-1 text-xs font-medium text-slate-400">{t('roles.standardAccess')}</p>
                <ul className="space-y-1.5">
                  {STANDARD_ACCESS_KEYS.map((key) => (
                    <li key={key} className="text-sm text-slate-600">
                      {t(`roles.standardAccessItems.${key}`)}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-500">
                    <ClipboardList size={13} /> {t('roles.assignedTasks')}
                  </p>
                  {role.assignedTasks.length === 0 ? (
                    <p className="text-xs text-slate-400">{t('roles.noAssignedTasks')}</p>
                  ) : (
                    <ul className="space-y-1">
                      {role.assignedTasks.map((task, i) => (
                        <li key={i} className="text-xs text-slate-600">
                          <span className="font-medium">{task.processName}</span> → {task.stepName}
                          {task.processStatus !== 'PUBLISHED' && (
                            <span className="ml-1 text-slate-400">
                              ({processStatusLabel(task.processStatus).toLowerCase()})
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-500">
                    <Lock size={13} /> {t('roles.permissionRules')}
                  </p>
                  {role.permissionRules.length === 0 ? (
                    <p className="text-xs text-slate-400">{t('roles.noPermissionRules')}</p>
                  ) : (
                    <ul className="space-y-1">
                      {role.permissionRules.map((r, i) => (
                        <li key={i} className="text-xs text-slate-600">
                          <span className="font-medium">{r.processName}</span> → {r.stepName} —{' '}
                          {t('roles.fieldCount', { count: r.fieldCount })}, documents :{' '}
                          {r.canUploadDocuments
                            ? t('roles.documentsUpload')
                            : r.canViewDocuments
                              ? t('roles.documentsView')
                              : t('roles.documentsNone')}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {role.name !== 'ADMIN' && canManage && (
                <div className="mt-4 border-t border-slate-100 pt-3">
                  <p className="mb-1 text-xs font-medium text-slate-400">{t('roles.configurePageAccess')}</p>
                  <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                    {PAGE_KEYS.map((key) => (
                      <label key={key} className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-slate-600">{t(`roles.pageLabels.${key}`)}</span>
                        <select
                          className="input w-auto py-1 text-xs"
                          value={getAccessDraft(role)[key]}
                          onChange={(e) => setAccessLevel(role, key, e.target.value as PageAccessLevel)}
                        >
                          {PAGE_LEVELS[key].map((lvl) => (
                            <option key={lvl} value={lvl}>
                              {t(`roles.levelLabels.${lvl}`)}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                  {accessError[role.id] && <p className="mt-2 text-sm text-rose-600">{accessError[role.id]}</p>}
                  <div className="mt-3 flex items-center gap-3">
                    <button onClick={() => saveAccess(role)} className="btn-primary">
                      <Save size={16} /> {t('roles.saveAccess')}
                    </button>
                    {accessStatus[role.id] && <span className="text-sm text-slate-400">{accessStatus[role.id]}</span>}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
        {roles.length === 0 && <div className="card text-center text-slate-400">{t('roles.loading')}</div>}
      </div>
    </div>
  );
}
