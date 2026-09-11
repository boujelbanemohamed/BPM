import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ListTree, Search } from 'lucide-react';
import { api } from '../api/client';
import { FieldRegistryRow } from '../types';
import { processStatusLabel } from '../lib/processStatus';

const statusBadge: Record<string, string> = {
  DRAFT: 'bg-amber-100 text-amber-700',
  PUBLISHED: 'bg-emerald-100 text-emerald-700',
  ARCHIVED: 'bg-slate-200 text-slate-600',
};

const STEP_TYPE_KEYS: Record<string, string> = {
  startEvent: 'startEvent',
  userTask: 'userTask',
  exclusiveGateway: 'exclusiveGateway',
  endEvent: 'endEvent',
};

export function FieldsRegistryPage() {
  const { t } = useTranslation();
  const [fields, setFields] = useState<FieldRegistryRow[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    api.listFieldsRegistry().then(({ fields }) => setFields(fields));
  }, []);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? fields.filter(
          (f) =>
            f.fieldKey.toLowerCase().includes(q) ||
            f.fieldLabel.toLowerCase().includes(q) ||
            f.processName.toLowerCase().includes(q) ||
            f.stepName.toLowerCase().includes(q)
        )
      : fields;

    const map = new Map<string, { processId: string; processName: string; processStatus: string; rows: FieldRegistryRow[] }>();
    for (const f of filtered) {
      const key = `${f.processId}`;
      if (!map.has(key)) map.set(key, { processId: f.processId, processName: f.processName, processStatus: f.processStatus, rows: [] });
      map.get(key)!.rows.push(f);
    }
    return [...map.values()];
  }, [fields, query]);

  return (
    <div className="mx-auto max-w-6xl p-6">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold text-slate-800">
        <ListTree size={22} /> {t('fields.title')}
      </h1>
      <p className="mb-4 text-sm text-slate-500">{t('fields.description')}</p>

      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          className="input pl-9"
          placeholder={t('fields.searchPlaceholder') as string}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="space-y-6">
        {grouped.map((g) => (
          <div key={g.processId} className="card">
            <div className="mb-3 flex items-center gap-2">
              <Link to={`/processes/${g.processId}`} className="font-semibold text-slate-700 hover:text-brand-600 hover:underline">
                {g.processName}
              </Link>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadge[g.processStatus]}`}>
                {processStatusLabel(g.processStatus)}
              </span>
            </div>
            <table className="w-full text-sm">
              <thead className="text-left text-xs font-semibold uppercase text-slate-400">
                <tr>
                  <th className="py-1.5">{t('fields.table.step')}</th>
                  <th className="py-1.5">{t('fields.table.type')}</th>
                  <th className="py-1.5">{t('fields.table.key')}</th>
                  <th className="py-1.5">{t('fields.table.label')}</th>
                  <th className="py-1.5">{t('fields.table.fieldType')}</th>
                  <th className="py-1.5">{t('fields.table.required')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {g.rows.map((f, i) => (
                  <tr key={i}>
                    <td className="py-1.5 text-slate-600">{f.stepName}</td>
                    <td className="py-1.5 text-slate-400">
                      {STEP_TYPE_KEYS[f.stepType] ? t(`fields.stepTypes.${STEP_TYPE_KEYS[f.stepType]}`) : f.stepType}
                    </td>
                    <td className="py-1.5 font-mono text-xs text-brand-700">{f.fieldKey}</td>
                    <td className="py-1.5 text-slate-600">{f.fieldLabel}</td>
                    <td className="py-1.5 text-slate-500">{f.fieldType}</td>
                    <td className="py-1.5">{f.required ? t('common.yes') : t('common.no')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {grouped.length === 0 && <div className="card text-center text-slate-400">{t('fields.empty')}</div>}
      </div>
    </div>
  );
}
