import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Save } from 'lucide-react';
import { api } from '../api/client';
import { FormField, PermissionMatrixRow, ProcessDefinition, Role } from '../types';
import { useAuth } from '../context/AuthContext';

interface StepInfo {
  id: string;
  name: string;
  formFields: FormField[];
}

function extractUserTaskSteps(xml: string): StepInfo[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const nodes = Array.from(doc.getElementsByTagName('bpmn:userTask'));
  return nodes.map((n) => {
    const raw = n.getAttribute('bpm:formFields');
    let formFields: FormField[] = [];
    if (raw) {
      try {
        formFields = JSON.parse(raw);
      } catch {
        formFields = [];
      }
    }
    return { id: n.getAttribute('id') ?? '', name: n.getAttribute('name') ?? n.getAttribute('id') ?? '', formFields };
  });
}

interface RowState {
  fieldPermissions: Record<string, { read: boolean; write: boolean }>;
  canViewDocuments: boolean;
  canUploadDocuments: boolean;
}

function rowKey(stepName: string, roleId: number): string {
  return `${stepName}::${roleId}`;
}

export function PermissionsMatrixPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { hasAccess } = useAuth();
  const canEdit = hasAccess('PERMISSIONS_MATRIX', 'FULL');
  const [process, setProcess] = useState<ProcessDefinition | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([api.getProcess(id), api.listRoles(), api.getPermissions(id)]).then(
      ([processRes, rolesRes, permRes]) => {
        setProcess(processRes.process);
        setRoles(rolesRes.roles);
        const initial: Record<string, RowState> = {};
        for (const row of permRes.permissions) {
          initial[rowKey(row.step_name, row.role_id)] = {
            fieldPermissions: row.field_permissions,
            canViewDocuments: row.can_view_documents,
            canUploadDocuments: row.can_upload_documents,
          };
        }
        setRows(initial);
      }
    );
  }, [id]);

  const steps = useMemo(() => (process ? extractUserTaskSteps(process.bpmn_xml) : []), [process]);
  const configurableRoles = roles.filter((r) => r.name !== 'ADMIN');

  function getRow(stepName: string, roleId: number): RowState {
    return rows[rowKey(stepName, roleId)] ?? { fieldPermissions: {}, canViewDocuments: true, canUploadDocuments: false };
  }

  function updateRow(stepName: string, roleId: number, patch: Partial<RowState>) {
    const key = rowKey(stepName, roleId);
    setRows((prev) => ({ ...prev, [key]: { ...getRow(stepName, roleId), ...patch } }));
  }

  function updateFieldPermission(stepName: string, roleId: number, field: string, patch: Partial<{ read: boolean; write: boolean }>) {
    const current = getRow(stepName, roleId);
    const currentField = current.fieldPermissions[field] ?? { read: false, write: false };
    updateRow(stepName, roleId, {
      fieldPermissions: { ...current.fieldPermissions, [field]: { ...currentField, ...patch } },
    });
  }

  async function save() {
    if (!process) return;
    setStatus(t('profile.saving'));
    const payload: PermissionMatrixRow[] = [];
    for (const step of steps) {
      for (const role of configurableRoles) {
        const row = getRow(step.name, role.id);
        payload.push({
          id: '',
          process_id: process.id,
          step_name: step.name,
          role_id: role.id,
          field_permissions: row.fieldPermissions,
          can_view_documents: row.canViewDocuments,
          can_upload_documents: row.canUploadDocuments,
        });
      }
    }
    try {
      await api.putPermissions(
        process.id,
        payload.map((r) => ({
          stepName: r.step_name,
          roleId: r.role_id,
          fieldPermissions: r.field_permissions,
          canViewDocuments: r.can_view_documents,
          canUploadDocuments: r.can_upload_documents,
        }))
      );
      setStatus(t('profile.saved'));
      setTimeout(() => setStatus(null), 1500);
    } catch (err) {
      setStatus((err as Error).message);
    }
  }

  if (!process) return <div className="p-6 text-slate-400">{t('designer.loading')}</div>;

  return (
    <div className="mx-auto max-w-6xl p-6">
      <Link to={`/processes/${process.id}`} className="mb-1 flex items-center gap-1 text-sm text-slate-500 hover:text-brand-600">
        <ArrowLeft size={14} /> {t('matrix.backToProcess')}
      </Link>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">{t('matrix.title', { name: process.name })}</h1>
        <div className="flex items-center gap-3">
          {status && <span className="text-sm text-slate-400">{status}</span>}
          {canEdit && (
            <button onClick={save} className="btn-primary">
              <Save size={16} /> {t('matrix.save')}
            </button>
          )}
        </div>
      </div>

      {steps.length === 0 && <p className="card text-slate-400">{t('matrix.noUserTasks')}</p>}

      <div className="space-y-6">
        {steps.map((step) => (
          <div key={step.id} className="card">
            <h2 className="mb-3 font-semibold text-slate-700">{step.name}</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs font-semibold uppercase text-slate-400">
                  <tr>
                    <th className="py-2 pr-4">{t('matrix.table.role')}</th>
                    {step.formFields.map((f) => (
                      <th key={f.key} className="px-2 py-2 text-center">
                        {f.label}
                      </th>
                    ))}
                    <th className="px-2 py-2 text-center">{t('matrix.table.viewDocuments')}</th>
                    <th className="px-2 py-2 text-center">{t('matrix.table.uploadDocuments')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {configurableRoles.map((role) => {
                    const row = getRow(step.name, role.id);
                    return (
                      <tr key={role.id}>
                        <td className="py-2 pr-4 font-medium text-slate-600">{role.name}</td>
                        {step.formFields.map((f) => {
                          const perm = row.fieldPermissions[f.key] ?? { read: false, write: false };
                          return (
                            <td key={f.key} className="px-2 py-2 text-center">
                              <div className="flex items-center justify-center gap-2">
                                <label className="flex items-center gap-1 text-xs text-slate-500">
                                  <input
                                    type="checkbox"
                                    checked={perm.read}
                                    disabled={!canEdit}
                                    onChange={(e) => updateFieldPermission(step.name, role.id, f.key, { read: e.target.checked })}
                                  />
                                  {t('matrix.table.read')}
                                </label>
                                <label className="flex items-center gap-1 text-xs text-slate-500">
                                  <input
                                    type="checkbox"
                                    checked={perm.write}
                                    disabled={!canEdit}
                                    onChange={(e) => updateFieldPermission(step.name, role.id, f.key, { write: e.target.checked })}
                                  />
                                  {t('matrix.table.write')}
                                </label>
                              </div>
                            </td>
                          );
                        })}
                        <td className="px-2 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={row.canViewDocuments}
                            disabled={!canEdit}
                            onChange={(e) => updateRow(step.name, role.id, { canViewDocuments: e.target.checked })}
                          />
                        </td>
                        <td className="px-2 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={row.canUploadDocuments}
                            disabled={!canEdit}
                            onChange={(e) => updateRow(step.name, role.id, { canUploadDocuments: e.target.checked })}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
