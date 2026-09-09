import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Settings, Play, PencilLine, ShieldCheck } from 'lucide-react';
import { api } from '../api/client';
import { ProcessDefinition } from '../types';
import { useAuth } from '../context/AuthContext';

const statusBadge: Record<string, string> = {
  DRAFT: 'bg-amber-100 text-amber-700',
  PUBLISHED: 'bg-emerald-100 text-emerald-700',
  ARCHIVED: 'bg-slate-200 text-slate-600',
};

export function ProcessesPage() {
  const { isAdmin } = useAuth();
  const [processes, setProcesses] = useState<ProcessDefinition[]>([]);
  const [error, setError] = useState<string | null>(null);
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

  async function publish(id: string) {
    if (!window.confirm('Publier ce processus ? Il ne pourra plus être modifié ensuite.')) return;
    try {
      await api.publishProcess(id);
      refresh();
    } catch (err) {
      window.alert((err as Error).message);
    }
  }

  async function start(id: string) {
    try {
      const { instance } = await api.startInstance(id);
      navigate(`/instances/${instance.id}`);
    } catch (err) {
      window.alert((err as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Processus</h1>
        {isAdmin && (
          <button
            onClick={createProcess}
            className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            <Plus size={16} /> Nouveau processus
          </button>
        )}
      </div>

      {error && <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

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
                    {p.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-500">{p.created_by_name}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => navigate(`/processes/${p.id}`)}
                      className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                    >
                      {p.status === 'DRAFT' ? <PencilLine size={14} /> : <Settings size={14} />}
                      {p.status === 'DRAFT' ? 'Modifier' : 'Voir'}
                    </button>
                    {isAdmin && (
                      <button
                        onClick={() => navigate(`/processes/${p.id}/permissions`)}
                        className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                      >
                        <ShieldCheck size={14} /> Droits
                      </button>
                    )}
                    {isAdmin && p.status === 'DRAFT' && (
                      <button
                        onClick={() => publish(p.id)}
                        className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                      >
                        Publier
                      </button>
                    )}
                    {p.status === 'PUBLISHED' && (
                      <button
                        onClick={() => start(p.id)}
                        className="flex items-center gap-1 rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
                      >
                        <Play size={14} /> Démarrer
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
    </div>
  );
}
