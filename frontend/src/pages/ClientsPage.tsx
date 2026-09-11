import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Eye, Plus, Search, Users } from 'lucide-react';
import { api } from '../api/client';
import { ClientItem } from '../types';
import { Pagination } from '../components/Pagination';

const LIMIT = 25;

export function ClientsPage() {
  const { t } = useTranslation();
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function refresh(q: string, off: number) {
    const { clients, total } = await api.listClients(q, { limit: LIMIT, offset: off });
    setClients(clients);
    setTotal(total);
  }

  useEffect(() => {
    refresh('', 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => {
      setOffset(0);
      refresh(query, 0);
    }, 250);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    if (offset === 0) return; // déjà rechargé par le debounce ci-dessus au changement de recherche
    refresh(query, offset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset]);

  async function createClient() {
    setError(null);
    if (!newName.trim()) {
      setError(t('clients.nameRequired'));
      return;
    }
    try {
      await api.createClient({ name: newName.trim(), email: newEmail.trim() || undefined, phone: newPhone.trim() || undefined });
      setNewName('');
      setNewEmail('');
      setNewPhone('');
      setCreating(false);
      refresh(query, offset);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-800">
          <Users size={22} /> {t('clients.title')}
        </h1>
        <button onClick={() => setCreating(!creating)} className="btn-primary">
          <Plus size={16} /> {t('clients.new')}
        </button>
      </div>

      {creating && (
        <div className="card mb-4 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <input className="input" placeholder={t('clients.namePlaceholder')} value={newName} onChange={(e) => setNewName(e.target.value)} />
            <input className="input" placeholder={t('clients.emailPlaceholder')} value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
            <input className="input" placeholder={t('clients.phonePlaceholder')} value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
          </div>
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
          <button onClick={createClient} className="btn-primary">
            {t('clients.create')}
          </button>
        </div>
      )}

      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          className="input pl-9"
          placeholder={t('clients.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">{t('clients.table.name')}</th>
              <th className="px-4 py-3">{t('clients.table.email')}</th>
              <th className="px-4 py-3">{t('clients.table.phone')}</th>
              <th className="px-4 py-3">{t('clients.table.folders')}</th>
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
                    <Eye size={14} /> {t('clients.view')}
                  </button>
                </td>
              </tr>
            ))}
            {clients.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  {t('clients.empty')}
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
