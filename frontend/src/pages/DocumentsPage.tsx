import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Folder, FolderPlus, X } from 'lucide-react';
import { api } from '../api/client';
import { DocumentFolder } from '../types';
import { useAuth } from '../context/AuthContext';

export function DocumentsPage() {
  const { hasAccess } = useAuth();
  const canManage = hasAccess('DOCUMENTS', 'FULL');
  const [folders, setFolders] = useState<DocumentFolder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState(false);

  async function refresh() {
    try {
      const { folders } = await api.listFolders();
      setFolders(folders);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  function openCreateModal() {
    setCreateName('');
    setCreateError(null);
    setCreateModalOpen(true);
  }

  async function submitCreateFolder(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    const trimmed = createName.trim();
    if (!trimmed) {
      setCreateError('Le nom est requis');
      return;
    }
    setCreateBusy(true);
    try {
      await api.createFolder(trimmed);
      setCreateModalOpen(false);
      refresh();
    } catch (err) {
      setCreateError((err as Error).message);
    } finally {
      setCreateBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Documents</h1>
        {canManage && (
          <button
            onClick={openCreateModal}
            className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            <FolderPlus size={16} /> Nouveau dossier
          </button>
        )}
      </div>

      {error && <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {folders.map((f) => (
          <Link
            key={f.id}
            to={`/documents/${f.id}`}
            className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 hover:border-brand-300 hover:shadow-sm"
          >
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
              <Folder size={20} />
            </span>
            <span className="min-w-0">
              <span className="block truncate font-semibold text-slate-800">{f.name}</span>
              <span className="block text-xs text-slate-400">
                {f.document_count ?? 0} document{(f.document_count ?? 0) > 1 ? 's' : ''} · {f.created_by_name}
              </span>
            </span>
          </Link>
        ))}
        {folders.length === 0 && (
          <p className="col-span-full py-8 text-center text-slate-400">Aucun dossier pour l'instant.</p>
        )}
      </div>

      {createModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold text-slate-800">Nouveau dossier</h2>
              <button onClick={() => setCreateModalOpen(false)} disabled={createBusy}>
                <X size={18} className="text-slate-400" />
              </button>
            </div>
            <form onSubmit={submitCreateFolder} className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">Nom du dossier</span>
                <input autoFocus className="input" value={createName} onChange={(e) => setCreateName(e.target.value)} />
              </label>
              {createError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{createError}</p>}
              <button type="submit" disabled={createBusy} className="btn-primary w-full justify-center">
                {createBusy ? 'Création…' : 'Créer le dossier'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
