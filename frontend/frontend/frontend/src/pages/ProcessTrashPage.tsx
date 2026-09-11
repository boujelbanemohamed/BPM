import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, RotateCcw, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import { ProcessDefinition } from '../types';

export function ProcessTrashPage() {
  const { t } = useTranslation();
  const [processes, setProcesses] = useState<ProcessDefinition[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const { processes } = await api.listProcessTrash();
      setProcesses(processes);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function restore(p: ProcessDefinition) {
    try {
      await api.restoreProcess(p.id);
      refresh();
    } catch (err) {
      window.alert((err as Error).message);
    }
  }

  async function permanentlyDelete(p: ProcessDefinition) {
    if (!window.confirm(t('trash.confirmDeletePermanently', { name: p.name, version: p.version }))) return;
    try {
      await api.permanentlyDeleteProcess(p.id);
      refresh();
    } catch (err) {
      window.alert((err as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-6xl p-6">
      <Link to="/processes" className="mb-1 flex items-center gap-1 text-sm text-slate-500 hover:text-brand-600">
        <ArrowLeft size={14} /> {t('designer.backToProcesses')}
      </Link>
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold text-slate-800">
        <Trash2 size={22} /> {t('trash.title')}
      </h1>

      {error && <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">{t('trash.table.reference')}</th>
              <th className="px-4 py-3">{t('trash.table.name')}</th>
              <th className="px-4 py-3">{t('trash.table.version')}</th>
              <th className="px-4 py-3">{t('trash.table.deletedBy')}</th>
              <th className="px-4 py-3">{t('trash.table.deletedAt')}</th>
              <th className="px-4 py-3 text-right">{t('trash.table.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {processes.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-mono text-xs text-slate-400">{p.reference}</td>
                <td className="px-4 py-3 font-medium text-slate-800">{p.name}</td>
                <td className="px-4 py-3 text-slate-500">v{p.version}</td>
                <td className="px-4 py-3 text-slate-500">{p.deleted_by_name ?? '—'}</td>
                <td className="px-4 py-3 text-slate-500">
                  {p.deleted_at ? new Date(p.deleted_at).toLocaleString('fr-FR') : '—'}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => restore(p)}
                      className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                    >
                      <RotateCcw size={14} /> {t('trash.restore')}
                    </button>
                    <button
                      onClick={() => permanentlyDelete(p)}
                      className="flex items-center gap-1 rounded-lg bg-rose-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
                    >
                      <Trash2 size={14} /> {t('trash.deletePermanently')}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {processes.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  {t('trash.empty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
