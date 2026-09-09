import { useEffect, useState } from 'react';
import { ScrollText, Search } from 'lucide-react';
import { api } from '../api/client';
import { AuditLogEntry } from '../types';

export function AuditPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [actionFilter, setActionFilter] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 50;

  async function refresh() {
    const { logs, total } = await api.listAuditLogs({
      action: actionFilter || undefined,
      limit,
      offset,
    });
    setLogs(logs);
    setTotal(total);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset]);

  function applyFilter(e: React.FormEvent) {
    e.preventDefault();
    setOffset(0);
    refresh();
  }

  return (
    <div className="mx-auto max-w-6xl p-6">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold text-slate-800">
        <ScrollText size={22} /> Audit trail
      </h1>

      <form onSubmit={applyFilter} className="mb-4 flex items-center gap-2">
        <input
          className="input max-w-xs"
          placeholder="Filtrer par action (ex: TASK_COMPLETED)"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
        />
        <button type="submit" className="btn-secondary">
          <Search size={14} /> Filtrer
        </button>
        <span className="text-sm text-slate-400">{total} événement(s)</span>
      </form>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Acteur</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Entité</th>
              <th className="px-4 py-3">Détails</th>
              <th className="px-4 py-3">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {logs.map((l) => (
              <tr key={l.id} className="align-top hover:bg-slate-50">
                <td className="whitespace-nowrap px-4 py-2 text-slate-500">{new Date(l.created_at).toLocaleString('fr-FR')}</td>
                <td className="px-4 py-2 text-slate-700">{l.actor_name ?? '—'}</td>
                <td className="px-4 py-2 font-mono text-xs text-brand-700">{l.action}</td>
                <td className="px-4 py-2 text-xs text-slate-400">
                  {l.entity_type}
                  {l.entity_id ? ` #${l.entity_id.slice(0, 8)}` : ''}
                </td>
                <td className="max-w-xs truncate px-4 py-2 text-xs text-slate-400" title={JSON.stringify(l.details)}>
                  {JSON.stringify(l.details)}
                </td>
                <td className="px-4 py-2 text-xs text-slate-400">{l.ip_address}</td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  Aucun événement.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
        <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))} className="btn-secondary disabled:opacity-40">
          Précédent
        </button>
        <span>
          {offset + 1}–{Math.min(offset + limit, total)} / {total}
        </span>
        <button disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)} className="btn-secondary disabled:opacity-40">
          Suivant
        </button>
      </div>
    </div>
  );
}
