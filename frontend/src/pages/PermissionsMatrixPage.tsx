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

function parseFormFields(node: Element): FormField[] {
  const raw = node.getAttribute('bpm:formFields');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function extractUserTaskSteps(doc: Document): StepInfo[] {
  const nodes = Array.from(doc.getElementsByTagName('bpmn:userTask'));
  return nodes.map((n) => ({
    id: n.getAttribute('id') ?? '',
    name: n.getAttribute('name') ?? n.getAttribute('id') ?? '',
    formFields: parseFormFields(n),
  }));
}

/** Tous les champs du dossier (formulaire de démarrage + toutes les tâches) :
 * à une étape donnée, un rôle doit pouvoir lire les données saisies aux étapes
 * précédentes, pas seulement les champs de sa propre étape. */
function extractAllFields(doc: Document, steps: StepInfo[]): FormField[] {
  const seen = new Map<string, FormField>();
  const startFields = Array.from(doc.getElementsByTagName('bpmn:startEvent')).flatMap(parseFormFields);
  for (const field of [...startFields, ...steps.flatMap((s) => s.formFields)]) {
    if (!seen.has(field.key)) seen.set(field.key, field);
  }
  return [...seen.values()];
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

  const { steps, allFields } = useMemo(() => {
    if (!process) return { steps: [], allFields: [] };
    const doc = new DOMParser().parseFromString(process.bpmn_xml, 'application/xml');
    const steps = extractUserTaskSteps(doc);
    return { steps, allFields: extractAllFields(doc, steps) };
  }, [process]);
  const configurableRoles = roles.filter((r) => r.name !== 'ADMIN');

  function isOwnField(step: StepInfo, key: string): boolean {
    return step.formFields.some((f) => f.key === key);
  }

  /** Sans règle enregistrée, le serveur laisse tout ouvert (lecture de tout le
   * dossier, écriture des champs de l'étape, documents) : l'affichage par
   * défaut reflète cet accès réel, et une première modification part de là. */
  function defaultRow(step: StepInfo): RowState {
    const fieldPermissions: RowState['fieldPermissions'] = {};
    for (const field of allFields) fieldPermissions[field.key] = { read: true, write: isOwnField(step, field.key) };
    return { fieldPermissions, canViewDocuments: true, canUploadDocuments: true };
  }

  function isConfigured(stepName: string, roleId: number): boolean {
    return rowKey(stepName, roleId) in rows;
  }

  function getRow(step: StepInfo, roleId: number): RowState {
    return rows[rowKey(step.name, roleId)] ?? defaultRow(step);
  }

  function updateRow(step: StepInfo, roleId: number, patch: Partial<RowState>) {
    const key = rowKey(step.name, roleId);
    setRows((prev) => ({ ...prev, [key]: { ...(prev[key] ?? defaultRow(step)), ...patch } }));
  }

  function updateFieldPermission(step: StepInfo, roleId: number, field: string, patch: Partial<{ read: boolean; write: boolean }>) {
    const current = getRow(step, roleId);
    const currentField = current.fieldPermissions[field] ?? { read: false, write: false };
    const next = { ...currentField, ...patch };
    // Écrire un champ suppose de pouvoir le lire.
    if (patch.write) next.read = true;
    if (patch.read === false) next.write = false;
    updateRow(step, roleId, { fieldPermissions: { ...current.fieldPermissions, [field]: next } });
  }

  async function save() {
    if (!process) return;
    setStatus(t('profile.saving'));
    // Seules les règles réellement définies sont envoyées : une étape/un rôle
    // jamais configuré garde l'accès par défaut au lieu de recevoir une règle
    // vide qui interdirait tout (y compris de traiter sa propre tâche).
    const payload: PermissionMatrixRow[] = [];
    for (const step of steps) {
      for (const role of configurableRoles) {
        if (!isConfigured(step.name, role.id)) continue;
        const row = getRow(step, role.id);
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
                    {allFields.map((f) => (
                      <th key={f.key} className={`px-2 py-2 text-center ${isOwnField(step, f.key) ? '' : 'font-normal'}`}>
                        {f.label}
                      </th>
                    ))}
                    <th className="px-2 py-2 text-center">{t('matrix.table.viewDocuments')}</th>
                    <th className="px-2 py-2 text-center">{t('matrix.table.uploadDocuments')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {configurableRoles.map((role) => {
                    const row = getRow(step, role.id);
                    return (
                      <tr key={role.id}>
                        <td className="py-2 pr-4 font-medium text-slate-600">
                          {role.name}
                          {!isConfigured(step.name, role.id) && (
                            <span className="block text-xs font-normal text-slate-400">{t('matrix.defaultAccess')}</span>
                          )}
                        </td>
                        {allFields.map((f) => {
                          const perm = row.fieldPermissions[f.key] ?? { read: false, write: false };
                          return (
                            <td key={f.key} className="px-2 py-2 text-center">
                              <div className="flex items-center justify-center gap-2">
                                <label className="flex items-center gap-1 text-xs text-slate-500">
                                  <input
                                    type="checkbox"
                                    checked={perm.read}
                                    disabled={!canEdit}
                                    onChange={(e) => updateFieldPermission(step, role.id, f.key, { read: e.target.checked })}
                                  />
                                  {t('matrix.table.read')}
                                </label>
                                {isOwnField(step, f.key) && (
                                  <label className="flex items-center gap-1 text-xs text-slate-500">
                                    <input
                                      type="checkbox"
                                      checked={perm.write}
                                      disabled={!canEdit}
                                      onChange={(e) => updateFieldPermission(step, role.id, f.key, { write: e.target.checked })}
                                    />
                                    {t('matrix.table.write')}
                                  </label>
                                )}
                              </div>
                            </td>
                          );
                        })}
                        <td className="px-2 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={row.canViewDocuments}
                            aria-label={t('matrix.table.viewDocuments')}
                            disabled={!canEdit}
                            onChange={(e) => updateRow(step, role.id, { canViewDocuments: e.target.checked })}
                          />
                        </td>
                        <td className="px-2 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={row.canUploadDocuments}
                            aria-label={t('matrix.table.uploadDocuments')}
                            disabled={!canEdit}
                            onChange={(e) => updateRow(step, role.id, { canUploadDocuments: e.target.checked })}
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
