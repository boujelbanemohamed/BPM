import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Download, Eye, FileText, MessageSquare, Paperclip, Send, UploadCloud, Users } from 'lucide-react';
import i18n from '../i18n';
import { api } from '../api/client';
import { AuditLogEntry, CommentItem, DocumentItem, ProcessInstance, TaskItem } from '../types';

const statusBadge: Record<string, string> = {
  RUNNING: 'bg-brand-100 text-brand-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-rose-100 text-rose-700',
  PENDING: 'bg-amber-100 text-amber-700',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${i18n.t('instanceDetail.bytesUnit')}`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ${i18n.t('instanceDetail.kilobytesUnit')}`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} ${i18n.t('instanceDetail.megabytesUnit')}`;
}

export function InstanceDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const [instance, setInstance] = useState<ProcessInstance | null>(null);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [events, setEvents] = useState<AuditLogEntry[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [commentBody, setCommentBody] = useState('');
  const [commentTaskId, setCommentTaskId] = useState('');
  const [commentError, setCommentError] = useState<string | null>(null);
  const [postingComment, setPostingComment] = useState(false);

  async function refresh() {
    if (!id) return;
    const [detail, docs, commentsRes] = await Promise.all([
      api.getInstance(id),
      api.listDocuments(id).catch(() => ({ documents: [] })),
      api.listComments(id).catch(() => ({ comments: [] })),
    ]);
    setInstance(detail.instance);
    setTasks(detail.tasks);
    setEvents(detail.events);
    setDocuments(docs.documents);
    setComments(commentsRes.comments);
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

  async function onSubmitComment(e: FormEvent) {
    e.preventDefault();
    if (!id || !commentBody.trim()) return;
    setCommentError(null);
    setPostingComment(true);
    try {
      await api.addComment(id, commentBody.trim(), commentTaskId || undefined);
      setCommentBody('');
      setCommentTaskId('');
      refresh();
    } catch (err) {
      setCommentError((err as Error).message);
    } finally {
      setPostingComment(false);
    }
  }

  if (!instance) return <div className="p-6 text-slate-400">{t('designer.loading')}</div>;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <Link to="/instances" className="mb-1 flex items-center gap-1 text-sm text-slate-500 hover:text-brand-600">
        <ArrowLeft size={14} /> {t('instanceDetail.backToInstances')}
      </Link>
      <div className="mb-6 flex items-center gap-2">
        <h1 className="text-xl font-bold text-slate-800">{instance.process_name}</h1>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadge[instance.status]}`}>{instance.status}</span>
        {instance.client_id && (
          <Link to={`/clients/${instance.client_id}`} className="flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline">
            <Users size={12} /> {t('instanceDetail.clientSheet')}
          </Link>
        )}
      </div>

      <div className="mb-4 card">
        <h2 className="mb-2 font-semibold text-slate-700">{t('instanceDetail.formDataHeading')}</h2>
        {Object.keys(instance.form_data).length === 0 ? (
          <p className="text-sm text-slate-400">{t('instanceDetail.formDataEmpty')}</p>
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
        <h2 className="mb-2 font-semibold text-slate-700">{t('instanceDetail.tasksHeading')}</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs font-semibold uppercase text-slate-400">
            <tr>
              <th className="py-1.5">{t('instanceDetail.table.step')}</th>
              <th className="py-1.5">{t('instanceDetail.table.status')}</th>
              <th className="py-1.5">{t('instanceDetail.table.assignedTo')}</th>
              <th className="py-1.5">{t('instanceDetail.table.completedBy')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {tasks.map((task) => (
              <tr key={task.id}>
                <td className="py-1.5">{task.step_name}</td>
                <td className="py-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadge[task.status]}`}>{task.status}</span>
                </td>
                <td className="py-1.5 text-slate-500">
                  {task.effective_assignee_name ?? task.role_name ?? '—'}
                  {task.is_delegated && <span className="ml-1 text-xs text-amber-600">{t('instanceDetail.delegatedSuffix')}</span>}
                </td>
                <td className="py-1.5 text-slate-500">{task.completed_by_name ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mb-4 card">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold text-slate-700">
            <Paperclip size={16} /> {t('instanceDetail.attachedDocuments')}
          </h2>
          <button onClick={() => fileInputRef.current?.click()} className="btn-secondary">
            <UploadCloud size={14} /> {t('documents.uploadFile')}
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
                  <Eye size={14} /> {t('documents.view')}
                </button>
                <button
                  onClick={() => api.downloadDocument(d.id, d.filename)}
                  className="flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline"
                >
                  <Download size={14} /> {t('documents.download')}
                </button>
              </span>
            </li>
          ))}
          {documents.length === 0 && <li className="py-2 text-slate-400">{t('documents.emptyFiles')}</li>}
        </ul>
      </div>

      <div className="mb-4 card">
        <h2 className="mb-2 flex items-center gap-2 font-semibold text-slate-700">
          <MessageSquare size={16} /> {t('instanceDetail.discussion')}
        </h2>
        <ul className="mb-3 space-y-2">
          {comments.map((c) => (
            <li key={c.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-700">{c.author_name}</span>
                {c.task_step_name && (
                  <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-700">
                    {c.task_step_name}
                  </span>
                )}
                <span className="text-xs text-slate-400">{new Date(c.created_at).toLocaleString('fr-FR')}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-slate-700">{c.body}</p>
            </li>
          ))}
          {comments.length === 0 && <li className="py-1 text-sm text-slate-400">{t('instanceDetail.noComments')}</li>}
        </ul>
        {commentError && <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{commentError}</p>}
        <form onSubmit={onSubmitComment} className="space-y-2">
          <textarea
            value={commentBody}
            onChange={(e) => setCommentBody(e.target.value)}
            placeholder={t('instanceDetail.commentPlaceholder') as string}
            rows={2}
            maxLength={4000}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
          />
          <div className="flex items-center justify-between gap-2">
            {tasks.length > 0 ? (
              <select
                value={commentTaskId}
                onChange={(e) => setCommentTaskId(e.target.value)}
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-600"
              >
                <option value="">{t('instanceDetail.generalComment')}</option>
                {tasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {t('instanceDetail.onTask', { name: task.step_name })}
                  </option>
                ))}
              </select>
            ) : (
              <span />
            )}
            <button type="submit" disabled={postingComment || !commentBody.trim()} className="btn-primary">
              <Send size={14} /> {t('instanceDetail.send')}
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h2 className="mb-2 font-semibold text-slate-700">{t('instanceDetail.history')}</h2>
        <ul className="space-y-1.5">
          {events.map((e) => (
            <li key={e.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
              {t(`instanceDetail.eventLabels.${e.action}`, { defaultValue: e.action })}
              {e.actor_name ? ` — ${e.actor_name}` : ''}
              <span className="ml-2 text-xs text-slate-400">{new Date(e.created_at).toLocaleString('fr-FR')}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
