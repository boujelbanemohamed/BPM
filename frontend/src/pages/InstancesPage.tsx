import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Eye } from 'lucide-react';
import { api } from '../api/client';
import { ProcessInstance } from '../types';
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
  const navigate = useNavigate();

  useEffect(() => {
    api.listInstances({ limit: LIMIT, offset }).then(({ instances, total }) => {
      setInstances(instances);
      setTotal(total);
    });
  }, [offset]);

  return (
    <div className="mx-auto max-w-6xl p-6">
      <h1 className="mb-6 text-2xl font-bold text-slate-800">{t('instances.title')}</h1>
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
