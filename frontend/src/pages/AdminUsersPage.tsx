import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, FileUp, PlusCircle, PowerOff, Power, PencilLine, ShieldCheck, ShieldOff, X } from 'lucide-react';
import { api } from '../api/client';
import { MinimalUser, PublicUser, Role } from '../types';
import { useAuth } from '../context/AuthContext';
import { Pagination } from '../components/Pagination';

interface ImportResult {
  created: number;
  updated: number;
  results: Array<{ row: number; email: string; action: 'created' | 'updated' }>;
  errors: Array<{ row: number; email?: string; message: string }>;
}

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

const LIMIT = 25;

export function AdminUsersPage() {
  const { t } = useTranslation();
  const { hasAccess } = useAuth();
  const canEdit = hasAccess('USERS', 'FULL');
  const [users, setUsers] = useState<PublicUser[]>([]);
  // Liste minimale non paginée (tous les utilisateurs), utilisée pour les
  // sélecteurs de suppléants et la résolution des noms dans le tableau :
  // ces deux usages doivent rester corrects même quand l'utilisateur
  // recherché n'est pas sur la page courante de `users`.
  const [allUsersMinimal, setAllUsersMinimal] = useState<MinimalUser[]>([]);
  const [total, setTotal] = useState(0);
  const [twoFactorEnabledCount, setTwoFactorEnabledCount] = useState(0);
  const [offset, setOffset] = useState(0);
  const [roles, setRoles] = useState<Role[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    const [usersRes, rolesRes, minimalRes] = await Promise.all([
      api.adminListUsers({ limit: LIMIT, offset }),
      api.listRoles(),
      api.listUsersMinimal(),
    ]);
    setUsers(usersRes.users);
    setTotal(usersRes.total);
    setTwoFactorEnabledCount(usersRes.twoFactorEnabledCount);
    setRoles(rolesRes.roles);
    setAllUsersMinimal(minimalRes.users);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset]);

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
    if (!window.confirm(t('adminUsers.confirmDeactivate', { name: u.fullName }))) return;
    try {
      const { reassignedTasks } = await api.adminDeactivateUser(u.id);
      setInfo(t('adminUsers.deactivatedInfo', { count: reassignedTasks }));
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

  async function downloadTemplate() {
    try {
      await api.downloadUsersCsvTemplate();
    } catch (err) {
      window.alert((err as Error).message);
    }
  }

  async function onCsvSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const result = await api.importUsersCsv(file);
      setImportResult(result);
      refresh();
    } catch (err) {
      window.alert((err as Error).message);
    } finally {
      setImporting(false);
      if (csvInputRef.current) csvInputRef.current.value = '';
    }
  }

  const otherUsers = allUsersMinimal.filter((u) => u.id !== form?.id);

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{t('adminUsers.title')}</h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
            <ShieldCheck size={14} className="text-emerald-600" />
            {t('adminUsers.twoFactorCount', { count: twoFactorEnabledCount, total })}
          </p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <button onClick={downloadTemplate} className="btn-secondary">
              <Download size={14} /> {t('adminUsers.downloadTemplate')}
            </button>
            <button onClick={() => csvInputRef.current?.click()} disabled={importing} className="btn-secondary">
              <FileUp size={14} /> {importing ? t('adminUsers.importing') : t('adminUsers.import')}
            </button>
            <input ref={csvInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onCsvSelected} />
            <button onClick={openCreate} className="btn-primary">
              <PlusCircle size={16} /> {t('adminUsers.new')}
            </button>
          </div>
        )}
      </div>

      {info && <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{info}</p>}

      {importResult && (
        <div className="card mb-6">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold text-slate-700">{t('adminUsers.importResultTitle')}</h2>
            <button onClick={() => setImportResult(null)}>
              <X size={16} className="text-slate-400" />
            </button>
          </div>
          <p className="mb-2 text-sm text-slate-600">
            <span className="font-semibold text-emerald-700">{t('adminUsers.created', { count: importResult.created })}</span> ·{' '}
            <span className="font-semibold text-brand-700">{t('adminUsers.updated', { count: importResult.updated })}</span>
            {importResult.errors.length > 0 && (
              <>
                {' '}
                · <span className="font-semibold text-rose-700">{t('adminUsers.errors', { count: importResult.errors.length })}</span>
              </>
            )}
          </p>
          {importResult.errors.length > 0 && (
            <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg bg-rose-50 p-3 text-xs text-rose-700">
              {importResult.errors.map((e, idx) => (
                <li key={idx}>
                  {t('adminUsers.row', { row: e.row })}
                  {e.email ? ` (${e.email})` : ''} : {e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {form && (
        <form onSubmit={submit} className="card mb-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-700">{form.id ? t('adminUsers.editTitle') : t('adminUsers.new')}</h2>
            <button type="button" onClick={() => setForm(null)}>
              <X size={18} className="text-slate-400" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">{t('profile.myInfo.firstName')}</span>
              <input
                required
                className="input"
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">{t('profile.myInfo.lastName')}</span>
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
              <span className="mb-1 block text-xs font-medium text-slate-500">{t('profile.myInfo.phone')}</span>
              <input
                type="tel"
                className="input"
                placeholder="+33 6 12 34 56 78"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">{t('profile.myInfo.email')}</span>
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
              {form.id ? t('adminUsers.passwordEditHint') : t('adminUsers.passwordNewHint')}
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
            <span className="mb-1 block text-xs font-medium text-slate-500">{t('adminUsers.roles')}</span>
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
              <span className="mb-1 block text-xs font-medium text-slate-500">{t('adminUsers.delegate1')}</span>
              <select className="input" value={form.delegateUser1Id} onChange={(e) => setForm({ ...form, delegateUser1Id: e.target.value })}>
                <option value="">{t('profile.delegation.none')}</option>
                {otherUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">{t('adminUsers.delegate2')}</span>
              <select className="input" value={form.delegateUser2Id} onChange={(e) => setForm({ ...form, delegateUser2Id: e.target.value })}>
                <option value="">{t('profile.delegation.none')}</option>
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
              <span className="mb-1 block text-xs font-medium text-slate-500">{t('profile.delegation.absenceStart')}</span>
              <input type="date" className="input" value={form.absenceStart} onChange={(e) => setForm({ ...form, absenceStart: e.target.value })} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">{t('profile.delegation.absenceEnd')}</span>
              <input type="date" className="input" value={form.absenceEnd} onChange={(e) => setForm({ ...form, absenceEnd: e.target.value })} />
            </label>
          </div>

          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
          <button type="submit" className="btn-primary">
            {form.id ? t('profile.save') : t('adminUsers.createAccount')}
          </button>
        </form>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">{t('adminUsers.table.name')}</th>
              <th className="px-4 py-3">{t('adminUsers.table.email')}</th>
              <th className="px-4 py-3">{t('adminUsers.table.roles')}</th>
              <th className="px-4 py-3">{t('adminUsers.table.status')}</th>
              <th className="px-4 py-3">{t('adminUsers.table.twoFactor')}</th>
              <th className="px-4 py-3">{t('adminUsers.table.delegates')}</th>
              <th className="px-4 py-3 text-right">{t('adminUsers.table.actions')}</th>
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
                    {u.isActive ? t('adminUsers.active') : t('adminUsers.inactive')}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {u.twoFactorEnabled ? (
                    <span className="flex items-center gap-1 text-xs font-semibold text-emerald-700">
                      <ShieldCheck size={14} /> {t('adminUsers.twoFactorEnabled')}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-slate-400">
                      <ShieldOff size={14} /> —
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">
                  {allUsersMinimal.find((x) => x.id === u.delegateUser1Id)?.fullName ?? '—'} /{' '}
                  {allUsersMinimal.find((x) => x.id === u.delegateUser2Id)?.fullName ?? '—'}
                </td>
                <td className="px-4 py-3">
                  {canEdit && (
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => openEdit(u)} className="btn-secondary">
                        <PencilLine size={14} /> {t('adminUsers.edit')}
                      </button>
                      {u.isActive ? (
                        <button
                          onClick={() => deactivate(u)}
                          className="flex items-center gap-1 rounded-lg bg-rose-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
                        >
                          <PowerOff size={14} /> {t('adminUsers.deactivate')}
                        </button>
                      ) : (
                        <button
                          onClick={() => activate(u)}
                          className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                        >
                          <Power size={14} /> {t('adminUsers.reactivate')}
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination offset={offset} limit={LIMIT} total={total} onOffsetChange={setOffset} />
    </div>
  );
}
