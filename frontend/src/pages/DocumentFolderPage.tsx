import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Download, Eye, FileText, Folder, Search, UploadCloud } from 'lucide-react';
import { api } from '../api/client';
import { DocumentFolder, LibraryDocumentItem } from '../types';
import { useAuth } from '../context/AuthContext';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export function DocumentFolderPage() {
  const { t } = useTranslation();
  const { hasAccess } = useAuth();
  const canManage = hasAccess('DOCUMENTS', 'FULL');
  const { id } = useParams<{ id: string }>();
  const [folder, setFolder] = useState<DocumentFolder | null>(null);
  const [documents, setDocuments] = useState<LibraryDocumentItem[]>([]);
  const [query, setQuery] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const latestIdRef = useRef<string | undefined>(id);

  async function refresh() {
    if (!id) return;
    latestIdRef.current = id;
    const { folder, documents } = await api.getFolder(id);
    if (latestIdRef.current !== id) return;
    setFolder(folder);
    setDocuments(documents);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const filteredDocuments = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return documents;
    return documents.filter((d) => d.filename.toLowerCase().includes(q));
  }, [documents, query]);

  async function onFileSelected(e: ChangeEvent<HTMLInputElement>) {
    if (!id || !e.target.files?.[0]) return;
    setUploadError(null);
    try {
      await api.uploadLibraryDocument(id, e.target.files[0]);
      refresh();
    } catch (err) {
      setUploadError((err as Error).message);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  if (!folder) return <div className="p-6 text-slate-400">{t('documents.loading')}</div>;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <Link to="/documents" className="mb-1 flex items-center gap-1 text-sm text-slate-500 hover:text-brand-600">
        <ArrowLeft size={14} /> {t('documents.backToDocuments')}
      </Link>
      <h1 className="mb-6 flex items-center gap-2 text-xl font-bold text-slate-800">
        <Folder size={20} className="text-brand-600" /> {folder.name}
      </h1>

      <div className="card">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold text-slate-700">{t('documents.title')}</h2>
          {canManage && (
            <>
              <button onClick={() => fileInputRef.current?.click()} className="btn-secondary">
                <UploadCloud size={14} /> {t('documents.uploadFile')}
              </button>
              <input ref={fileInputRef} type="file" className="hidden" onChange={onFileSelected} />
            </>
          )}
        </div>
        {uploadError && <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{uploadError}</p>}
        {documents.length > 0 && (
          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-8 text-sm"
              placeholder={t('documents.searchFilesPlaceholder') as string}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        )}
        <ul className="divide-y divide-slate-100 text-sm">
          {filteredDocuments.map((d) => (
            <li key={d.id} className="flex items-center justify-between py-2">
              <span className="flex items-center gap-2 text-slate-700">
                <FileText size={14} className="text-slate-400" /> {d.filename}
                <span className="text-xs text-slate-400">
                  ({formatBytes(d.size_bytes)} · {d.uploaded_by_name})
                </span>
              </span>
              <span className="flex items-center gap-3">
                <button
                  onClick={() => api.viewLibraryDocument(d.id).catch((err) => window.alert((err as Error).message))}
                  className="flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline"
                >
                  <Eye size={14} /> {t('documents.view')}
                </button>
                <button
                  onClick={() => api.downloadLibraryDocument(d.id, d.filename)}
                  className="flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline"
                >
                  <Download size={14} /> {t('documents.download')}
                </button>
              </span>
            </li>
          ))}
          {documents.length === 0 && <li className="py-2 text-slate-400">{t('documents.emptyFiles')}</li>}
          {documents.length > 0 && filteredDocuments.length === 0 && (
            <li className="py-2 text-slate-400">{t('documents.noSearchResults')}</li>
          )}
        </ul>
      </div>
    </div>
  );
}
