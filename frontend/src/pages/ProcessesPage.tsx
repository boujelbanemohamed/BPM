import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, Download, FileUp, Plus, Settings, Play, PencilLine, ShieldCheck, X } from 'lucide-react';
import { api } from '../api/client';
import { ProcessDefinition } from '../types';
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
  const { hasAccess } = useAuth();
  const canDesign = hasAccess('PROCESSES_DESIGN', 'FULL');
  const canSeePermissions = hasAccess('PERMISSIONS_MATRIX', 'VIEW');
  const [processes, setProcesses] = useState<ProcessDefinition[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [startModalProcess, setStartModalProcess] = useState<ProcessDefinition | null>(null);
  const [startBusy, setStartBusy] = useState(false);
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

  async function createProcess() {
    const name = window.prompt('Nom du nouveau processus');
    if (!name) return;
    try {
      const { process } = await api.createProcess({ name });
      navigate(`/processes/${process.id}`);
    } catch (err) {
      window.alert((err as Error).message);
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
    if (!window.confirm('Publier ce processus ? Il ne pourra plus être modifié ensuite.')) return;
    try {
      await api.publishProcess(id);
      refresh();
    } catch (err) {
      window.alert((err as Error).message);
    }
  }

  async function archive(id: string) {
    if (
      !window.confirm(
        "Archiver ce processus ? Il ne pourra plus être démarré, mais les instances déjà en cours continueront normalement."
      )
    )
      return;
    try {
      await api.archiveProcess(id);
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
        <h1 className="text-2xl font-bold text-slate-800">Processus</h1>
        {canDesign && (
          <div className="flex items-center gap-2">
            <button
              onClick={downloadTemplate}
              className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              <Download size={14} /> Modèle XML
            </button>
            <button
              onClick={() => xmlInputRef.current?.click()}
              disabled={importing}
              className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              <FileUp size={14} /> {importing ? 'Import en cours…' : 'Importer XML'}
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
              onClick={createProcess}
              className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
            >
              <Plus size={16} /> Nouveau processus
            </button>
          </div>
        )}
      </div>

      {error && <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      {importResult && (
        <div className="card mb-6">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold text-slate-700">Résultat de l'import XML</h2>
            <button onClick={() => setImportResult(null)}>
              <X size={16} className="text-slate-400" />
            </button>
          </div>
          <p className="mb-2 text-sm text-slate-600">
            <span className="font-semibold text-emerald-700">{importResult.created} processus créé(s)</span>
            {importResult.errors.length > 0 && (
              <>
                {' '}
                · <span className="font-semibold text-rose-700">{importResult.errors.length} erreur(s)</span>
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

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Nom</th>
              <th className="px-4 py-3">Version</th>
              <th className="px-4 py-3">Statut</th>
              <th className="px-4 py-3">Créé par</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {processes.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-800">{p.name}</td>
                <td className="px-4 py-3 text-slate-500">v{p.version}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadge[p.status]}`}>
                    {processStatusLabel(p.status)}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-500">{p.created_by_name}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => navigate(`/processes/${p.id}`)}
                      className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                    >
                      {p.status === 'DRAFT' && canDesign ? <PencilLine size={14} /> : <Settings size={14} />}
                      {p.status === 'DRAFT' && canDesign ? 'Modifier' : 'Voir'}
                    </button>
                    {canSeePermissions && (
                      <button
                        onClick={() => navigate(`/processes/${p.id}/permissions`)}
                        className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                      >
                        <ShieldCheck size={14} /> Droits
                      </button>
                    )}
                    {canDesign && p.status === 'DRAFT' && (
                      <button
                        onClick={() => publish(p.id)}
                        className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                      >
                        Publier
                      </button>
                    )}
                    {p.status === 'PUBLISHED' && (
                      <button
                        onClick={() => start(p)}
                        className="flex items-center gap-1 rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
                      >
                        <Play size={14} /> Démarrer
                      </button>
                    )}
                    {canDesign && p.status === 'PUBLISHED' && (
                      <button
                        onClick={() => archive(p.id)}
                        className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                      >
                        <Archive size={14} /> Archiver
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {processes.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  Aucun processus pour l'instant.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {startModalProcess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold text-slate-800">Démarrer : {startModalProcess.name}</h2>
              <button onClick={() => setStartModalProcess(null)} disabled={startBusy}>
                <X size={18} className="text-slate-400" />
              </button>
            </div>
            <DynamicForm
              fields={extractFormFields(startModalProcess.bpmn_xml, 'startEvent')}
              submitLabel="Démarrer l'instance"
              busy={startBusy}
              onSubmit={(formData) => startInstance(startModalProcess.id, formData)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
