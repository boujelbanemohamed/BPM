import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Archive,
  Copy,
  Download,
  Eye,
  FileText,
  FileUp,
  Folder,
  GitCompare,
  Plus,
  Settings,
  Play,
  PencilLine,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '../api/client';
import { DocumentFolder, LibraryDocumentItem, ProcessDefinition } from '../types';
import { useAuth } from '../context/AuthContext';
import { DynamicForm, extractFormFields } from '../components/DynamicForm';
import { processStatusLabel } from '../lib/processStatus';

interface ImportResult {
  created: number;
  results: Array<{ file: string; processId: string; name: string }>;
  errors: Array<{ file: string; message: string }>;
}

const statusBadge: Record<string, string> = {
  DRAFT: 'bg-amber-100 text-amber-700',
  PUBLISHED: 'bg-emerald-100 text-emerald-700',
  ARCHIVED: 'bg-slate-200 text-slate-600',
};

export function ProcessesPage() {
  const { t } = useTranslation();
  const { hasAccess } = useAuth();
  const canDesign = hasAccess('PROCESSES_DESIGN', 'FULL');
  const canSeePermissions = hasAccess('PERMISSIONS_MATRIX', 'VIEW');
  const [processes, setProcesses] = useState<ProcessDefinition[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [startModalProcess, setStartModalProcess] = useState<ProcessDefinition | null>(null);
  const [startBusy, setStartBusy] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createVersion, setCreateVersion] = useState('1');
  const [attachmentType, setAttachmentType] = useState<'none' | 'folder' | 'document'>('none');
  const [attachedFolderId, setAttachedFolderId] = useState('');
  const [attachedDocumentId, setAttachedDocumentId] = useState('');
  const [attachableFolders, setAttachableFolders] = useState<DocumentFolder[]>([]);
  const [attachableDocuments, setAttachableDocuments] = useState<LibraryDocumentItem[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const xmlInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  async function refresh() {
    try {
      const { processes } = await api.listProcesses();
      setProcesses(processes);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  function openCreateModal() {
    setCreateName('');
    setCreateVersion('1');
    setAttachmentType('none');
    setAttachedFolderId('');
    setAttachedDocumentId('');
    setCreateError(null);
    setCreateModalOpen(true);
    api.listFolders().then(({ folders }) => setAttachableFolders(folders)).catch(() => {});
    api.listAllLibraryDocuments().then(({ documents }) => setAttachableDocuments(documents)).catch(() => {});
  }

  async function submitCreateProcess(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    const trimmedName = createName.trim();
    if (!trimmedName) {
      setCreateError(t('processes.nameRequired'));
      return;
    }
    const version = createVersion.trim() ? Number(createVersion) : undefined;
    if (version !== undefined && (!Number.isInteger(version) || version < 1)) {
      setCreateError(t('processes.versionInvalid'));
      return;
    }
    if (attachmentType === 'folder' && !attachedFolderId) {
      setCreateError(t('processes.selectFolder'));
      return;
    }
    if (attachmentType === 'document' && !attachedDocumentId) {
      setCreateError(t('processes.selectDocument'));
      return;
    }
    setCreateBusy(true);
    try {
      const { process } = await api.createProcess({
        name: trimmedName,
        version,
        attachedFolderId: attachmentType === 'folder' ? attachedFolderId : undefined,
        attachedDocumentId: attachmentType === 'document' ? attachedDocumentId : undefined,
      });
      setCreateModalOpen(false);
      navigate(`/processes/${process.id}`);
    } catch (err) {
      setCreateError((err as Error).message);
    } finally {
      setCreateBusy(false);
    }
  }

  async function downloadTemplate() {
    try {
      await api.downloadProcessImportTemplate();
    } catch (err) {
      window.alert((err as Error).message);
    }
  }

  async function onXmlSelected(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setImporting(true);
    setImportResult(null);
    try {
      const result = await api.importProcessesXml(files);
      setImportResult(result);
      refresh();
    } catch (err) {
      window.alert((err as Error).message);
    } finally {
      setImporting(false);
      if (xmlInputRef.current) xmlInputRef.current.value = '';
    }
  }

  async function publish(id: string) {
    if (!window.confirm(t('processes.confirmPublish'))) return;
    try {
      await api.publishProcess(id);
      refresh();
    } catch (err) {
      window.alert((err as Error).message);
    }
  }

  async function archive(id: string) {
    if (!window.confirm(t('processes.confirmArchive'))) return;
    try {
      await api.archiveProcess(id);
      refresh();
    } catch (err) {
      window.alert((err as Error).message);
    }
  }

  const [duplicating, setDuplicating] = useState<string | null>(null);

  async function duplicate(process: ProcessDefinition) {
    setDuplicating(process.id);
    try {
      const { process: created } = await api.duplicateProcess(process.id);
      navigate(`/processes/${created.id}`);
    } catch (err) {
      window.alert((err as Error).message);
    } finally {
      setDuplicating(null);
    }
  }

  async function deleteProcess(process: ProcessDefinition) {
    if (!window.confirm(t('processes.confirmDelete', { name: process.name, version: process.version }))) return;
    try {
      await api.deleteProcess(process.id);
      refresh();
    } catch (err) {
      window.alert((err as Error).message);
    }
  }

  function start(process: ProcessDefinition) {
    const startFields = extractFormFields(process.bpmn_xml, 'startEvent');
    if (startFields.length === 0) {
      startInstance(process.id, {});
      return;
    }
    setStartModalProcess(process);
  }

  async function startInstance(processId: string, formData: Record<string, unknown>) {
    setStartBusy(true);
    try {
      const { instance } = await api.startInstance(processId, formData);
      setStartModalProcess(null);
      navigate(`/instances/${instance.id}`);
    } catch (err) {
      window.alert((err as Error).message);
    } finally {
      setStartBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">{t('processes.title')}</h1>
        {canDesign && (
          <div className="flex items-center gap-2">
            <Link
              to="/processes/trash"
              className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              <Trash2 size={14} /> {t('processes.trash')}
            </Link>
            <button
              onClick={downloadTemplate}
              className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              <Download size={14} /> {t('processes.downloadTemplate')}
            </button>
            <button
              onClick={() => xmlInputRef.current?.click()}
              disabled={importing}
              className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              <FileUp size={14} /> {importing ? t('processes.importing') : t('processes.import')}
            </button>
            <input
              ref={xmlInputRef}
              type="file"
              accept=".xml,.bpmn,application/xml,text/xml"
              multiple
              className="hidden"
              onChange={onXmlSelected}
            />
            <button
              onClick={openCreateModal}
              className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
            >
              <Plus size={16} /> {t('processes.new')}
            </button>
          </div>
        )}
      </div>

      {error && <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      {importResult && (
        <div className="card mb-6">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold text-slate-700">{t('processes.importResultTitle')}</h2>
            <button onClick={() => setImportResult(null)}>
              <X size={16} className="text-slate-400" />
            </button>
          </div>
          <p className="mb-2 text-sm text-slate-600">
            <span className="font-semibold text-emerald-700">{t('processes.importCreated', { count: importResult.created })}</span>
            {importResult.errors.length > 0 && (
              <>
                {' '}
                · <span className="font-semibold text-rose-700">{t('processes.importErrors', { count: importResult.errors.length })}</span>
              </>
            )}
          </p>
          {importResult.errors.length > 0 && (
            <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg bg-rose-50 p-3 text-xs text-rose-700">
              {importResult.errors.map((e, idx) => (
                <li key={idx}>
                  {e.file} : {e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">{t('processes.table.reference')}</th>
              <th className="px-4 py-3">{t('processes.table.name')}</th>
              <th className="px-4 py-3">{t('processes.table.version')}</th>
              <th className="px-4 py-3">{t('processes.table.status')}</th>
              <th className="px-4 py-3">{t('processes.table.attachment')}</th>
              <th className="px-4 py-3">{t('processes.table.createdBy')}</th>
              <th className="px-4 py-3 text-right">{t('processes.table.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {processes.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-mono text-xs text-slate-400">{p.reference}</td>
                <td className="px-4 py-3 font-medium text-slate-800">{p.name}</td>
                <td className="px-4 py-3 text-slate-500">v{p.version}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadge[p.status]}`}>
                    {processStatusLabel(p.status)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {p.attached_folder_id && (
                    <Link
                      to={`/documents/${p.attached_folder_id}`}
                      className="flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline"
                    >
                      <Folder size={13} /> {p.attached_folder_name}
                    </Link>
                  )}
                  {p.attached_document_id && (
                    <span className="flex items-center gap-1.5 text-xs text-slate-500">
                      <FileText size={13} className="shrink-0 text-slate-400" />
                      <span className="truncate">{p.attached_document_name}</span>
                      <button
                        onClick={() =>
                          api
                            .viewLibraryDocument(p.attached_document_id!)
                            .catch((err) => window.alert((err as Error).message))
                        }
                        className="shrink-0 text-brand-600 hover:text-brand-700"
                        title={t('processes.visualize')}
                      >
                        <Eye size={13} />
                      </button>
                    </span>
                  )}
                  {!p.attached_folder_id && !p.attached_document_id && <span className="text-xs text-slate-300">—</span>}
                </td>
                <td className="px-4 py-3 text-slate-500">{p.created_by_name}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => navigate(`/processes/${p.id}`)}
                      className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                    >
                      {p.status === 'DRAFT' && canDesign ? <PencilLine size={14} /> : <Settings size={14} />}
                      {p.status === 'DRAFT' && canDesign ? t('processes.edit') : t('processes.view')}
                    </button>
                    {p.status === 'PUBLISHED' &&
                      processes.some((other) => other.process_key === p.process_key && other.id !== p.id && other.status === 'PUBLISHED') && (
                        <button
                          onClick={() => navigate(`/processes/${p.id}/compare`)}
                          className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                        >
                          <GitCompare size={14} /> {t('processes.compare')}
                        </button>
                      )}
                    {canSeePermissions && (
                      <button
                        onClick={() => navigate(`/processes/${p.id}/permissions`)}
                        className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                      >
                        <ShieldCheck size={14} /> {t('processes.permissions')}
                      </button>
                    )}
                    {canDesign && p.status === 'DRAFT' && (
                      <button
                        onClick={() => publish(p.id)}
                        className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                      >
                        {t('processes.publish')}
                      </button>
                    )}
                    {p.status === 'PUBLISHED' && (
                      <button
                        onClick={() => start(p)}
                        className="flex items-center gap-1 rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
                      >
                        <Play size={14} /> {t('processes.start')}
                      </button>
                    )}
                    {canDesign && p.status === 'PUBLISHED' && (
                      <button
                        onClick={() => archive(p.id)}
                        className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                      >
                        <Archive size={14} /> {t('processes.archive')}
                      </button>
                    )}
                    {canDesign && (
                      <button
                        onClick={() => duplicate(p)}
                        disabled={duplicating === p.id}
                        className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                      >
                        <Copy size={14} /> {duplicating === p.id ? t('processes.duplicating') : t('processes.duplicate')}
                      </button>
                    )}
                    {canDesign && p.status !== 'PUBLISHED' && (p.instance_count ?? 0) === 0 && (
                      <button
                        onClick={() => deleteProcess(p)}
                        className="flex items-center gap-1 rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50"
                      >
                        <Trash2 size={14} /> {t('processes.delete')}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {processes.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  {t('processes.empty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {createModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold text-slate-800">{t('processes.createModal.title')}</h2>
              <button onClick={() => setCreateModalOpen(false)} disabled={createBusy}>
                <X size={18} className="text-slate-400" />
              </button>
            </div>
            <form onSubmit={submitCreateProcess} className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">{t('processes.createModal.name')}</span>
                <input
                  autoFocus
                  className="input"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">{t('processes.createModal.version')}</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  className="input"
                  value={createVersion}
                  onChange={(e) => setCreateVersion(e.target.value)}
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">{t('processes.createModal.attachment')}</span>
                <select
                  className="input"
                  value={attachmentType}
                  onChange={(e) => setAttachmentType(e.target.value as 'none' | 'folder' | 'document')}
                >
                  <option value="none">{t('processes.createModal.none')}</option>
                  <option value="folder">{t('processes.createModal.folderOption')}</option>
                  <option value="document">{t('processes.createModal.documentOption')}</option>
                </select>
              </label>

              {attachmentType === 'folder' && (
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">{t('processes.createModal.attachFolder')}</span>
                  <select className="input" value={attachedFolderId} onChange={(e) => setAttachedFolderId(e.target.value)}>
                    <option value="">{t('processes.createModal.chooseFolder')}</option>
                    {attachableFolders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name} ({t('processes.createModal.documentCount', { count: f.document_count ?? 0 })})
                      </option>
                    ))}
                  </select>
                  {attachableFolders.length === 0 && (
                    <span className="mt-1 block text-xs text-slate-400">{t('processes.createModal.noFolders')}</span>
                  )}
                </label>
              )}

              {attachmentType === 'document' && (
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">{t('processes.createModal.attachDocument')}</span>
                  <select
                    className="input"
                    value={attachedDocumentId}
                    onChange={(e) => setAttachedDocumentId(e.target.value)}
                  >
                    <option value="">{t('processes.createModal.chooseDocument')}</option>
                    {attachableDocuments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.filename} ({d.folder_name})
                      </option>
                    ))}
                  </select>
                  {attachableDocuments.length === 0 && (
                    <span className="mt-1 block text-xs text-slate-400">{t('processes.createModal.noDocuments')}</span>
                  )}
                </label>
              )}

              {createError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{createError}</p>}
              <button type="submit" disabled={createBusy} className="btn-primary w-full justify-center">
                {createBusy ? t('processes.createModal.creating') : t('processes.createModal.submit')}
              </button>
            </form>
          </div>
        </div>
      )}

      {startModalProcess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold text-slate-800">{t('processes.startModal.title', { name: startModalProcess.name })}</h2>
              <button onClick={() => setStartModalProcess(null)} disabled={startBusy}>
                <X size={18} className="text-slate-400" />
              </button>
            </div>
            <DynamicForm
              fields={extractFormFields(startModalProcess.bpmn_xml, 'startEvent')}
              submitLabel={t('processes.startModal.submit')}
              busy={startBusy}
              onSubmit={(formData) => startInstance(startModalProcess.id, formData)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
