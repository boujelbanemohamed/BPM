import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { ClientItem } from '../types';

export function ClientPicker({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [open, setOpen] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(() => {
      api.listClients(query).then(({ clients }) => setClients(clients));
    }, 200);
    return () => clearTimeout(handle);
  }, [query, open]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function select(client: ClientItem) {
    onChange(client.id);
    setSelectedLabel(client.name);
    setQuery('');
    setOpen(false);
    setCreating(false);
  }

  async function createNew() {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const { client } = await api.createClient({
        name: newName.trim(),
        email: newEmail.trim() || undefined,
        phone: newPhone.trim() || undefined,
      });
      select(client);
      setNewName('');
      setNewEmail('');
      setNewPhone('');
    } catch (err) {
      window.alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <input
        className="input"
        placeholder={t('clients.searchPlaceholder') as string}
        value={open ? query : selectedLabel}
        onFocus={() => {
          setOpen(true);
          setQuery('');
        }}
        onChange={(e) => setQuery(e.target.value)}
      />
      {!value && !open && <p className="mt-1 text-xs text-amber-600">{t('clientPicker.noneSelected')}</p>}

      {open && (
        <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {clients.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => select(c)}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
            >
              <span className="font-medium text-slate-700">{c.name}</span>
              {c.email && <span className="ml-2 text-xs text-slate-400">{c.email}</span>}
            </button>
          ))}
          {clients.length === 0 && !creating && <p className="px-3 py-2 text-xs text-slate-400">{t('clientPicker.noClientsFound')}</p>}

          {!creating && (
            <button
              type="button"
              onClick={() => {
                setCreating(true);
                setNewName(query);
              }}
              className="block w-full border-t border-slate-100 px-3 py-2 text-left text-xs font-semibold text-brand-600 hover:bg-slate-50"
            >
              {query ? t('clientPicker.newClientWithQuery', { query }) : t('clientPicker.newClient')}
            </button>
          )}

          {creating && (
            <div className="space-y-2 border-t border-slate-100 p-3">
              <input className="input text-sm" placeholder={t('clients.namePlaceholder') as string} value={newName} onChange={(e) => setNewName(e.target.value)} />
              <input className="input text-sm" placeholder={t('clients.emailPlaceholder') as string} value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
              <input className="input text-sm" placeholder={t('clients.phonePlaceholder') as string} value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
              <button
                type="button"
                onClick={createNew}
                disabled={busy || !newName.trim()}
                className="btn-primary w-full text-xs"
              >
                {busy ? t('clientPicker.creating') : t('clientPicker.createAndSelect')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
