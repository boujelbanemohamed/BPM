import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, Plus, Search, Users } from 'lucide-react';
import { api } from '../api/client';
import { ClientItem } from '../types';

export function ClientsPage() {
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function refresh(q = query) {
    const { clients } = await api.listClients(q);
    setClients(clients);
  }

  useEffect(() => {
    refresh('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => refresh(query), 250);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  async function createClient() {
    setError(null);
    if (!newName.trim()) {
      setError('Le nom est obligatoire');
      return;
    }
    try {
      await api.createClient({ name: newName.trim(), email: newEmail.trim() || undefined, phone: newPhone.trim() || undefined });
      setNewName('');
      setNewEmail('');
      setNewPhone('');
      setCreating(false);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-800">
          <Users size={22} /> Clients
        </h1>
        <button onClick={() => setCreating(!creating)} className="btn-primary">
          <Plus size={16} /> Nouveau client
        </button>
      </div>

      {creating && (
        <div className="card mb-4 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <input className="input" placeholder="Nom *" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <input className="input" placeholder="Email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
            <input className="input" placeholder="Téléphone" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
          </div>
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
          <button onClick={createClient} className="btn-primary">
            Créer
          </button>
        </div>
      )}

      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          className="input pl-9"
          placeholder="Rechercher un client…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Nom</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Téléphone</th>
              <th className="px-4 py-3">Dossiers</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {clients.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-800">{c.name}</td>
                <td className="px-4 py-3 text-slate-500">{c.email ?? '—'}</td>
                <td className="px-4 py-3 text-slate-500">{c.phone ?? '—'}</td>
                <td className="px-4 py-3 text-slate-500">{c.instance_count ?? 0}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => navigate(`/clients/${c.id}`)} className="btn-secondary">
                    <Eye size={14} /> Voir
                  </button>
                </td>
              </tr>
            ))}
            {clients.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  Aucun client.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
