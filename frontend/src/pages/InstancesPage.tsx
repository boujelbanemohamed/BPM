import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Download, Eye } from 'lucide-react';
import { api } from '../api/client';
import { InstanceStatus, ProcessInstance } from '../types';
import { ContextLine } from '../components/DynamicForm';
import { Pagination } from '../components/Pagination';

const statusBadge: Record<string, string> = {
  RUNNING: 'bg-brand-100 text-brand-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-rose-100 text-rose-700',
};

const LIMIT = 25;

export function InstancesPage() {
  const { t } = useTranslation();
  const [instances, setInstances] = useState<ProcessInstance[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState<InstanceStatus | ''>('');
  const [processKey, setProcessKey] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [processOptions, setProcessOptions] = useState<{ process_key: string; name: string }[]>([]);
  const [exporting, setExporting] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api.listInstanceProcessFilters().then(({ processes }) => setProcessOptions(processes));
  }, []);

  useEffect(() => {
    api
      .listInstances({
        limit: LIMIT,
        offset,
        status: status || undefined,
        processKey: processKey || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      })
      .then(({ instances, total }) => {
        setInstances(instances);
        setTotal(total);
      });
  }, [offset, status, processKey, dateFrom, dateTo]);

  function resetAndFilter<T>(setter: (v: T) => void, value: T) {
    setter(value);
    setOffset(0);
  }

  async function exportCsv() {
    setExporting(true);
    try {
      await api.exportInstancesCsv({
        status: status || undefined,
        processKey: processKey || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
    } catch (err) {
      window.alert((err as Error).message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">{t('instances.title')}</h1>
        <button onClick={exportCsv} disabled={exporting} className="btn-secondary">
          <Download size={14} /> {exporting ? t('instances.exporting') : t('instances.export')}
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          className="input w-auto"
          value={status}
          onChange={(e) => resetAndFilter(setStatus, e.target.value as InstanceStatus | '')}
        >
          <option value="">{t('instances.filters.allStatuses')}</option>
          <option value="RUNNING">{t('instances.filters.running')}</option>
          <option value="COMPLETED">{t('instances.filters.completed')}</option>
          <option value="CANCELLED">{t('instances.filters.cancelled')}</option>
        </select>
        <select className="input w-auto" value={processKey} onChange={(e) => resetAndFilter(setProcessKey, e.target.value)}>
          <option value="">{t('instances.filters.allProcesses')}</option>
          {processOptions.map((p) => (
            <option key={p.process_key} value={p.process_key}>
              {p.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-sm text-slate-500">
          {t('instances.filters.from')}
          <input
            type="date"
            className="input w-auto"
            value={dateFrom}
            onChange={(e) => resetAndFilter(setDateFrom, e.target.value)}
          />
        </label>
        <label className="flex items-center gap-1 text-sm text-slate-500">
          {t('instances.filters.to')}
          <input
            type="date"
            className="input w-auto"
            value={dateTo}
            onChange={(e) => resetAndFilter(setDateTo, e.target.value)}
          />
        </label>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">{t('instances.table.process')}</th>
              <th className="px-4 py-3">{t('instances.table.status')}</th>
              <th className="px-4 py-3">{t('instances.table.currentStep')}</th>
              <th className="px-4 py-3">{t('instances.table.startedBy')}</th>
              <th className="px-4 py-3">{t('instances.table.startedAt')}</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {instances.map((i) => (
              <tr key={i.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-800">{i.process_name}</div>
                  <ContextLine data={i.form_data} />
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadge[i.status]}`}>{i.status}</span>
                </td>
                <td className="px-4 py-3 text-slate-500">{i.current_step_name ?? '—'}</td>
                <td className="px-4 py-3 text-slate-500">{i.started_by_name}</td>
                <td className="px-4 py-3 text-slate-500">{new Date(i.started_at).toLocaleString('fr-FR')}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => navigate(`/instances/${i.id}`)} className="btn-secondary">
                    <Eye size={14} /> {t('instances.view')}
                  </button>
                </td>
              </tr>
            ))}
            {instances.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  {t('instances.empty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination offset={offset} limit={LIMIT} total={total} onOffsetChange={setOffset} />
    </div>
  );
}
