import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FileText, FolderOpen, Loader2, PlayCircle, Search, Workflow, X } from 'lucide-react';
import { api } from '../api/client';
import { SearchResults } from '../types';

const DEBOUNCE_MS = 300;
const MIN_LENGTH = 2;

const EMPTY_RESULTS: SearchResults = { processes: [], instances: [], documents: [] };

export function SearchBox() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onEscape);
    };
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_LENGTH) {
      setResults(EMPTY_RESULTS);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const data = await api.search(trimmed);
        setResults(data);
      } catch {
        setResults(EMPTY_RESULTS);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  function goTo(path: string) {
    navigate(path);
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
  }

  const trimmed = query.trim();
  const hasQuery = trimmed.length >= MIN_LENGTH;
  const hasResults = results.processes.length > 0 || results.instances.length > 0 || results.documents.length > 0;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`rounded-full p-2 text-slate-500 hover:bg-slate-100 ${open ? 'bg-slate-100' : ''}`}
        aria-label={t('common.search.ariaLabel')}
      >
        <Search size={20} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 flex w-72 max-w-[90vw] items-center gap-2 rounded-lg border border-brand-400 bg-white px-3 py-1.5 text-sm text-slate-500 shadow-lg sm:w-80">
          <Search size={16} className="shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('common.search.placeholder')}
            className="w-full bg-transparent text-slate-700 placeholder:text-slate-400 focus:outline-none"
          />
          <button
            onClick={() => {
              setOpen(false);
              setQuery('');
            }}
            className="shrink-0 text-slate-400 hover:text-slate-600"
            aria-label={t('common.search.close')}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {open && hasQuery && (
        <div className="absolute right-0 top-full z-20 mt-11 max-h-[28rem] w-96 max-w-[90vw] overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-400">
              <Loader2 size={16} className="animate-spin" /> {t('common.search.loading')}
            </div>
          )}
          {!loading && !hasResults && (
            <div className="py-6 text-center text-sm text-slate-400">{t('common.search.noResults', { query: trimmed })}</div>
          )}
          {!loading && results.processes.length > 0 && (
            <div className="mb-2">
              <div className="px-2 py-1 text-xs font-semibold uppercase text-slate-400">{t('common.search.processes')}</div>
              {results.processes.map((p) => (
                <button
                  key={p.id}
                  onClick={() => goTo(`/processes/${p.id}`)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100"
                >
                  <Workflow size={15} className="shrink-0 text-brand-600" />
                  <span className="truncate">{p.name}</span>
                  <span className="ml-auto shrink-0 text-xs text-slate-400">{p.reference}</span>
                </button>
              ))}
            </div>
          )}
          {!loading && results.instances.length > 0 && (
            <div className="mb-2">
              <div className="px-2 py-1 text-xs font-semibold uppercase text-slate-400">{t('common.search.instances')}</div>
              {results.instances.map((i) => (
                <button
                  key={i.id}
                  onClick={() => goTo(`/instances/${i.id}`)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100"
                >
                  <PlayCircle size={15} className="shrink-0 text-brand-600" />
                  <span className="truncate">
                    {i.processName}
                    {i.clientName ? ` · ${i.clientName}` : ''}
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-slate-400">{i.currentStepName}</span>
                </button>
              ))}
            </div>
          )}
          {!loading && results.documents.length > 0 && (
            <div>
              <div className="px-2 py-1 text-xs font-semibold uppercase text-slate-400">{t('common.search.documents')}</div>
              {results.documents.map((d) => (
                <button
                  key={`${d.type}-${d.id}`}
                  onClick={() => goTo(d.type === 'folder' ? `/documents/${d.id}` : `/documents/${d.folderId}`)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100"
                >
                  {d.type === 'folder' ? (
                    <FolderOpen size={15} className="shrink-0 text-brand-600" />
                  ) : (
                    <FileText size={15} className="shrink-0 text-brand-600" />
                  )}
                  <span className="truncate">{d.label}</span>
                  {d.type === 'document' && <span className="ml-auto shrink-0 text-xs text-slate-400">{d.folderName}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
