import { useEffect, useState } from 'react';
import { Database } from 'lucide-react';
import { api } from '../api/client';
import { DatabaseTable } from '../types';

export function DatabaseSchemaPage() {
  const [tables, setTables] = useState<DatabaseTable[]>([]);

  useEffect(() => {
    api.getDatabaseSchema().then(({ tables }) => setTables(tables));
  }, []);

  return (
    <div className="mx-auto max-w-6xl p-6">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold text-slate-800">
        <Database size={22} /> Base de données
      </h1>
      <p className="mb-4 text-sm text-slate-500">
        Structure actuelle du schéma PostgreSQL ({tables.length} table{tables.length > 1 ? 's' : ''}) — lecture seule.
      </p>

      <div className="grid gap-6 md:grid-cols-2">
        {tables.map((t) => (
          <div key={t.name} className="card">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-mono text-sm font-bold text-slate-800">{t.name}</h2>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">
                {t.rowCount} ligne{t.rowCount > 1 ? 's' : ''}
              </span>
            </div>
            <table className="w-full text-xs">
              <thead className="text-left font-semibold uppercase text-slate-400">
                <tr>
                  <th className="py-1">Colonne</th>
                  <th className="py-1">Type</th>
                  <th className="py-1">Null</th>
                  <th className="py-1">Défaut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {t.columns.map((c) => (
                  <tr key={c.name}>
                    <td className="py-1 font-mono text-slate-700">{c.name}</td>
                    <td className="py-1 text-slate-500">{c.type}</td>
                    <td className="py-1 text-slate-400">{c.nullable ? 'oui' : 'non'}</td>
                    <td className="max-w-[140px] truncate py-1 text-slate-400" title={c.default ?? ''}>
                      {c.default ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {tables.length === 0 && <div className="card text-center text-slate-400 md:col-span-2">Chargement…</div>}
      </div>
    </div>
  );
}
