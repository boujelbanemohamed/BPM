import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Download, Eye, FileText, Paperclip, UploadCloud, Users } from 'lucide-react';
import { api } from '../api/client';
import { AuditLogEntry, DocumentItem, ProcessInstance, TaskItem } from '../types';

const EVENT_LABELS: Record<string, string> = {
  INSTANCE_STARTED: 'Instance démarrée',
  TASK_CREATED: 'Tâche créée',
  TASK_COMPLETED: 'Tâche complétée',
  EDGE_TAKEN: 'Transition',
  GATEWAY_EVALUATED: 'Passerelle évaluée',
  PROCESS_COMPLETED: 'Processus terminé',
  TASK_REASSIGNED: 'Tâche réassignée (suppléance)',
  DOCUMENT_UPLOADED: 'Document déposé',
  DOCUMENT_DOWNLOADED: 'Document consulté',
};

const statusBadge: Record<string, string> = {
  RUNNING: 'bg-brand-100 text-brand-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-rose-100 text-rose-700',
  PENDING: 'bg-amber-100 text-amber-700',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export function InstanceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [instance, setInstance] = useState<ProcessInstance | null>(null);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [events, setEvents] = useState<AuditLogEntry[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    if (!id) return;
    const [detail, docs] = await Promise.all([api.getInstance(id), api.listDocuments(id).catch(() => ({ documents: [] }))]);
    setInstance(detail.instance);
    setTasks(detail.tasks);
    setEvents(detail.events);
    setDocuments(docs.documents);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function onFileSelected(e: ChangeEvent<HTMLInputElement>) {
    if (!id || !e.target.files?.[0]) return;
    setUploadError(null);
    try {
      await api.uploadDocument(id, e.target.files[0]);
      refresh();
    } catch (err) {
      setUploadError((err as Error).message);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  if (!instance) return <div className="p-6 text-slate-400">Chargement…</div>;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <Link to="/instances" className="mb-1 flex items-center gap-1 text-sm text-slate-500 hover:text-brand-600">
        <ArrowLeft size={14} /> Retour aux instances
      </Link>
      <div className="mb-6 flex items-center gap-2">
        <h1 className="text-xl font-bold text-slate-800">{instance.process_name}</h1>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadge[instance.status]}`}>{instance.status}</span>
        {instance.client_id && (
          <Link to={`/clients/${instance.client_id}`} className="flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline">
            <Users size={12} /> Fiche client
          </Link>
        )}
      </div>

      <div className="mb-4 card">
        <h2 className="mb-2 font-semibold text-slate-700">Données du dossier</h2>
        {Object.keys(instance.form_data).length === 0 ? (
          <p className="text-sm text-slate-400">Aucune donnée visible pour votre rôle à cette étape.</p>
        ) : (
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {Object.entries(instance.form_data).map(([key, value]) => (
              <div key={key}>
                <dt className="text-xs font-medium uppercase text-slate-400">{key}</dt>
                <dd className="text-slate-700">{String(value)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <div className="mb-4 card">
        <h2 className="mb-2 font-semibold text-slate-700">Tâches</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs font-semibold uppercase text-slate-400">
            <tr>
              <th className="py-1.5">Étape</th>
              <th className="py-1.5">Statut</th>
              <th className="py-1.5">Assignée à</th>
              <th className="py-1.5">Complétée par</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {tasks.map((t) => (
              <tr key={t.id}>
                <td className="py-1.5">{t.step_name}</td>
                <td className="py-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadge[t.status]}`}>{t.status}</span>
                </td>
                <td className="py-1.5 text-slate-500">
                  {t.effective_assignee_name ?? t.role_name ?? '—'}
                  {t.is_delegated && <span className="ml-1 text-xs text-amber-600">(suppléance)</span>}
                </td>
                <td className="py-1.5 text-slate-500">{t.completed_by_name ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mb-4 card">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold text-slate-700">
            <Paperclip size={16} /> Documents joints
          </h2>
          <button onClick={() => fileInputRef.current?.click()} className="btn-secondary">
            <UploadCloud size={14} /> Déposer un fichier
          </button>
          <input ref={fileInputRef} type="file" className="hidden" onChange={onFileSelected} />
        </div>
        {uploadError && <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{uploadError}</p>}
        <ul className="divide-y divide-slate-100 text-sm">
          {documents.map((d) => (
            <li key={d.id} className="flex items-center justify-between py-2">
              <span className="flex items-center gap-2 text-slate-700">
                <FileText size={14} className="text-slate-400" /> {d.filename}
                <span className="text-xs text-slate-400">
                  ({formatBytes(d.size_bytes)} · {d.uploaded_by_name})
                </span>
              </span>
              <span className="flex items-center gap-3">
                <button
                  onClick={() => api.viewDocument(d.id).catch((err) => window.alert((err as Error).message))}
                  className="flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline"
                >
                  <Eye size={14} /> Visualiser
                </button>
                <button
                  onClick={() => api.downloadDocument(d.id, d.filename)}
                  className="flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline"
                >
                  <Download size={14} /> Télécharger
                </button>
              </span>
            </li>
          ))}
          {documents.length === 0 && <li className="py-2 text-slate-400">Aucun document.</li>}
        </ul>
      </div>

      <div className="card">
        <h2 className="mb-2 font-semibold text-slate-700">Historique / traçabilité</h2>
        <ul className="space-y-1.5">
          {events.map((e) => (
            <li key={e.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
              {EVENT_LABELS[e.action] ?? e.action}
              {e.actor_name ? ` — ${e.actor_name}` : ''}
              <span className="ml-2 text-xs text-slate-400">{new Date(e.created_at).toLocaleString('fr-FR')}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}