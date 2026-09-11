import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Eye, Save } from 'lucide-react';
import { api } from '../api/client';
import { ClientItem, ProcessInstance } from '../types';

const statusBadge: Record<string, string> = {
  RUNNING: 'bg-brand-100 text-brand-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-rose-100 text-rose-700',
};

export function ClientDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const [client, setClient] = useState<ClientItem | null>(null);
  const [instances, setInstances] = useState<ProcessInstance[]>([]);
  const [form, setForm] = useState({ name: '', email: '', phone: '', address: '', notes: '' });
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    if (!id) return;
    const { client, instances } = await api.getClient(id);
    setClient(client);
    setInstances(instances);
    setForm({
      name: client.name,
      email: client.email ?? '',
      phone: client.phone ?? '',
      address: client.address ?? '',
      notes: client.notes ?? '',
    });
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function save() {
    if (!id) return;
    setError(null);
    setStatus(t('clients.detail.saving'));
    try {
      await api.updateClient(id, form);
      setStatus(t('clients.detail.saved'));
      setTimeout(() => setStatus(null), 1500);
      refresh();
    } catch (err) {
      setError((err as Error).message);
      setStatus(null);
    }
  }

  if (!client) return <div className="p-6 text-slate-400">{t('documents.loading')}</div>;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <Link to="/clients" className="mb-1 flex items-center gap-1 text-sm text-slate-500 hover:text-brand-600">
        <ArrowLeft size={14} /> {t('clients.detail.backToClients')}
      </Link>
      <h1 className="mb-6 text-2xl font-bold text-slate-800">{client.name}</h1>

      <div className="card mb-6 space-y-4">
        <h2 className="font-semibold text-slate-700">{t('clients.detail.contactInfo')}</h2>
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">{t('clients.detail.name')}</span>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">{t('clients.table.email')}</span>
            <input className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">{t('clients.table.phone')}</span>
            <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">{t('clients.detail.address')}</span>
            <input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">{t('clients.detail.notes')}</span>
          <textarea
            className="input"
            rows={3}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </label>
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <div className="flex items-center gap-3">
          <button onClick={save} className="btn-primary">
            <Save size={16} /> {t('clients.detail.save')}
          </button>
          {status && <span className="text-sm text-slate-400">{status}</span>}
        </div>
      </div>

      <div className="card">
        <h2 className="mb-3 font-semibold text-slate-700">{t('clients.detail.relatedProcesses', { count: instances.length })}</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs font-semibold uppercase text-slate-400">
            <tr>
              <th className="py-1.5">{t('clients.detail.table.process')}</th>
              <th className="py-1.5">{t('clients.detail.table.status')}</th>
              <th className="py-1.5">{t('clients.detail.table.currentStep')}</th>
              <th className="py-1.5">{t('clients.detail.table.startedAt')}</th>
              <th className="py-1.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {instances.map((i) => (
              <tr key={i.id}>
                <td className="py-1.5 font-medium text-slate-700">{i.process_name}</td>
                <td className="py-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadge[i.status]}`}>{i.status}</span>
                </td>
                <td className="py-1.5 text-slate-500">{i.current_step_name ?? '—'}</td>
                <td className="py-1.5 text-slate-500">{new Date(i.started_at).toLocaleDateString('fr-FR')}</td>
                <td className="py-1.5 text-right">
                  <Link to={`/instances/${i.id}`} className="flex items-center justify-end gap-1 text-xs font-semibold text-brand-600 hover:underline">
                    <Eye size={12} /> {t('clients.detail.view')}
                  </Link>
                </td>
              </tr>
            ))}
            {instances.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-slate-400">
                  {t('clients.detail.empty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
