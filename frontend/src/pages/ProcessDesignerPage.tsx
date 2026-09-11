import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Archive,
  ArrowLeft,
  Download,
  Eye,
  FileText,
  Folder,
  PencilLine,
  Printer,
  Save,
  ShieldCheck,
  UploadCloud,
  X,
} from 'lucide-react';
import { api } from '../api/client';
import { DocumentFolder, LibraryDocumentItem, MinimalUser, ProcessDefinition, Role } from '../types';
import { BpmnDesigner, BpmnDesignerHandle } from '../components/BpmnDesigner';
import { useAuth } from '../context/AuthContext';
import { processStatusLabel } from '../lib/processStatus';

const statusBadge: Record<string, string> = {
  DRAFT: 'bg-amber-100 text-amber-700',
  PUBLISHED: 'bg-emerald-100 text-emerald-700',
  ARCHIVED: 'bg-slate-200 text-slate-600',
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function ProcessDesignerPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasAccess } = useAuth();
  const canDesign = hasAccess('PROCESSES_DESIGN', 'FULL');
  const canSeePermissions = hasAccess('PERMISSIONS_MATRIX', 'VIEW');
  const [process, setProcess] = useState<ProcessDefinition | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [users, setUsers] = useState<MinimalUser[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const designerRef = useRef<BpmnDesignerHandle>(null);
  const [attachEditing, setAttachEditing] = useState(false);
  const [attachType, setAttachType] = useState<'none' | 'folder' | 'document'>('none');
  const [attachFolderId, setAttachFolderId] = useState('');
  const [attachDocumentId, setAttachDocumentId] = useState('');
  const [attachableFolders, setAttachableFolders] = useState<DocumentFolder[]>([]);
  const [attachableDocuments, setAttachableDocuments] = useState<LibraryDocumentItem[]>([]);
  const [attachBusy, setAttachBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.getProcess(id).then(({ process }) => setProcess(process));
    api.listRoles().then(({ roles }) => setRoles(roles));
    api.listUsersMinimal().then(({ users }) => setUsers(users));
  }, [id]);

  async function save() {
    if (!process || !designerRef.current) return;
    setStatus('Enregistrement…');
    setError(null);
    try {
      const bpmnXml = await designerRef.current.getXml();
      const { process: updated } = await api.updateProcess(process.id, { bpmnXml });
      setProcess(updated);
      setStatus('Enregistré');
      setTimeout(() => setStatus(null), 1500);
    } catch (err) {
      setError((err as Error).message);
      setStatus(null);
    }
  }

  async function saveReference(value: string) {
    if (!process) return;
    const trimmed = value.trim();
    if (!trimmed || trimmed === process.reference) return;
    try {
      const { process: updated } = await api.updateProcess(process.id, { reference: trimmed });
      setProcess(updated);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function saveVersion(value: string) {
    if (!process) return;
    const num = Number(value);
    if (!Number.isInteger(num) || num < 1 || num === process.version) return;
    try {
      const { process: updated } = await api.updateProcess(process.id, { version: num });
      setProcess(updated);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function exportPdf() {
    if (!process || !designerRef.current) return;
    // Ouvre l'onglet immédiatement (dans le geste utilisateur du clic) pour
    // éviter le blocage popup, puis y écrit le contenu une fois le SVG prêt.
    const printTab = window.open('', '_blank');
    try {
      const svg = await designerRef.current.getSvg();
      if (!printTab) throw new Error("Impossible d'ouvrir l'onglet d'impression (bloqué par le navigateur)");

      const exportDate = new Date().toLocaleString('fr-FR');
      const statusClass = process.status.toLowerCase();
      printTab.document.write(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(process.name)} — export PDF</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 24px; color: #1e293b; }
  header { margin-bottom: 20px; border-bottom: 2px solid #e2e8f0; padding-bottom: 12px; }
  h1 { margin: 0 0 6px; font-size: 20px; display: flex; align-items: center; gap: 10px; }
  .meta { font-size: 13px; color: #64748b; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 9999px; font-size: 11px; font-weight: 600; }
  .badge-draft { background: #fef3c7; color: #92400e; }
  .badge-published { background: #d1fae5; color: #065f46; }
  .badge-archived { background: #e2e8f0; color: #475569; }
  .diagram svg { width: 100%; height: auto; max-height: 900px; }
  .print-bar { margin-bottom: 16px; }
  .print-bar button {
    padding: 8px 16px; font-size: 14px; font-weight: 600; border-radius: 8px;
    border: none; background: #4f46e5; color: white; cursor: pointer;
  }
  @media print { .print-bar { display: none; } }
  @page { size: A4 landscape; margin: 12mm; }
</style>
</head>
<body>
  <div class="print-bar"><button onclick="window.print()">Imprimer / Enregistrer en PDF</button></div>
  <header>
    <h1>${escapeHtml(process.name)} <span class="badge badge-${statusClass}">${escapeHtml(processStatusLabel(process.status))}</span></h1>
    <div class="meta">${escapeHtml(process.reference)} · Version ${process.version} · Exporté le ${exportDate}</div>
  </header>
  <div class="diagram">${svg}</div>
</body>
</html>`);
      printTab.document.close();
    } catch (err) {
      printTab?.close();
      window.alert((err as Error).message);
    }
  }

  async function publish() {
    if (!process) return;
    await save();
    try {
      const { process: updated } = await api.publishProcess(process.id);
      setProcess(updated);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function openAttachEditor() {
    if (!process) return;
    setAttachType(process.attached_folder_id ? 'folder' : process.attached_document_id ? 'document' : 'none');
    setAttachFolderId(process.attached_folder_id ?? '');
    setAttachDocumentId(process.attached_document_id ?? '');
    setAttachEditing(true);
    api.listFolders().then(({ folders }) => setAttachableFolders(folders)).catch(() => {});
    api.listAllLibraryDocuments().then(({ documents }) => setAttachableDocuments(documents)).catch(() => {});
  }

  async function saveAttachment() {
    if (!process) return;
    setAttachBusy(true);
    setError(null);
    try {
      const { process: updated } = await api.updateProcess(process.id, {
        attachedFolderId: attachType === 'folder' ? attachFolderId || null : null,
        attachedDocumentId: attachType === 'document' ? attachDocumentId || null : null,
      });
      setProcess(updated);
      setAttachEditing(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAttachBusy(false);
    }
  }

  async function archive() {
    if (!process) return;
    if (
      !window.confirm(
        "Archiver ce processus ? Il ne pourra plus être démarré, mais les instances déjà en cours continueront normalement."
      )
    )
      return;
    try {
      const { process: updated } = await api.archiveProcess(process.id);
      setProcess(updated);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!process) return <div className="p-6 text-slate-400">Chargement…</div>;

  const readOnly = process.status !== 'DRAFT' || !canDesign;
  const canEditMeta = canDesign && process.status !== 'PUBLISHED';

  return (
    <div className="mx-auto max-w-[1400px] p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <Link to="/processes" className="mb-1 flex items-center gap-1 text-sm text-slate-500 hover:text-brand-600">
            <ArrowLeft size={14} /> Retour aux processus
          </Link>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-800">
            {process.name}
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadge[process.status]}`}>
              {processStatusLabel(process.status)}
            </span>
          </h1>
          <p className="mt-0.5 flex items-center gap-1 font-mono text-xs text-slate-400">
            {canEditMeta ? (
              <input
                key={`ref-${process.id}-${process.reference}`}
                defaultValue={process.reference}
                onBlur={(e) => saveReference(e.target.value)}
                className="w-28 rounded border border-slate-200 bg-white px-1 py-0.5 font-mono text-xs text-slate-600"
              />
            ) : (
              <span>{process.reference}</span>
            )}
            <span>·</span>
            {canEditMeta ? (
              <span className="flex items-center gap-0.5">
                v
                <input
                  key={`ver-${process.id}-${process.version}`}
                  type="number"
                  min={1}
                  defaultValue={process.version}
                  onBlur={(e) => saveVersion(e.target.value)}
                  className="w-14 rounded border border-slate-200 bg-white px-1 py-0.5 font-mono text-xs text-slate-600"
                />
              </span>
            ) : (
              <span>v{process.version}</span>
            )}
          </p>
          {!attachEditing && (
            <div className="mt-1 flex items-center gap-2">
              {process.attached_folder_id && (
                <Link
                  to={`/documents/${process.attached_folder_id}`}
                  className="flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline"
                >
                  <Folder size={13} /> {process.attached_folder_name}
                </Link>
              )}
              {process.attached_document_id && (
                <span className="flex items-center gap-2 text-xs text-slate-500">
                  <FileText size={13} className="text-slate-400" /> {process.attached_document_name}
                  <button
                    onClick={() =>
                      api
                        .viewLibraryDocument(process.attached_document_id!)
                        .catch((err) => window.alert((err as Error).message))
                    }
                    className="flex items-center gap-0.5 font-semibold text-brand-600 hover:underline"
                  >
                    <Eye size={12} /> Visualiser
                  </button>
                  <button
                    onClick={() => api.downloadLibraryDocument(process.attached_document_id!, process.attached_document_name!)}
                    className="flex items-center gap-0.5 font-semibold text-brand-600 hover:underline"
                  >
                    <Download size={12} /> Télécharger
                  </button>
                </span>
              )}
              {!process.attached_folder_id && !process.attached_document_id && (
                <span className="text-xs text-slate-400">Aucune pièce jointe</span>
              )}
              {canDesign && (
                <button
                  onClick={openAttachEditor}
                  className="flex items-center gap-0.5 text-xs font-semibold text-brand-600 hover:underline"
                >
                  <PencilLine size={12} /> Modifier
                </button>
              )}
            </div>
          )}

          {attachEditing && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
              <select
                className="input w-auto py-1 text-xs"
                value={attachType}
                onChange={(e) => setAttachType(e.target.value as 'none' | 'folder' | 'document')}
              >
                <option value="none">— aucune pièce jointe —</option>
                <option value="folder">Un dossier</option>
                <option value="document">Un document</option>
              </select>
              {attachType === 'folder' && (
                <select
                  className="input w-auto py-1 text-xs"
                  value={attachFolderId}
                  onChange={(e) => setAttachFolderId(e.target.value)}
                >
                  <option value="">— choisir un dossier —</option>
                  {attachableFolders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              )}
              {attachType === 'document' && (
                <select
                  className="input w-auto py-1 text-xs"
                  value={attachDocumentId}
                  onChange={(e) => setAttachDocumentId(e.target.value)}
                >
                  <option value="">— choisir un document —</option>
                  {attachableDocuments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.filename} ({d.folder_name})
                    </option>
                  ))}
                </select>
              )}
              <button
                onClick={saveAttachment}
                disabled={attachBusy || (attachType === 'folder' && !attachFolderId) || (attachType === 'document' && !attachDocumentId)}
                className="rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {attachBusy ? 'Enregistrement…' : 'Enregistrer'}
              </button>
              <button
                onClick={() => setAttachEditing(false)}
                disabled={attachBusy}
                className="flex items-center gap-0.5 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
              >
                <X size={12} /> Annuler
              </button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {status && <span className="text-sm text-slate-400">{status}</span>}
          <button onClick={exportPdf} className="btn-secondary">
            <Printer size={16} /> Imprimer PDF
          </button>
          {canSeePermissions && (
            <button onClick={() => navigate(`/processes/${process.id}/permissions`)} className="btn-secondary">
              <ShieldCheck size={16} /> Matrice de droits
            </button>
          )}
          {!readOnly && (
            <>
              <button onClick={save} className="btn-secondary">
                <Save size={16} /> Enregistrer
              </button>
              <button onClick={publish} className="btn-primary">
                <UploadCloud size={16} /> Publier
              </button>
            </>
          )}
          {canDesign && process.status === 'PUBLISHED' && (
            <button onClick={archive} className="btn-secondary">
              <Archive size={16} /> Archiver
            </button>
          )}
        </div>
      </div>

      {error && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      {readOnly && process.status === 'PUBLISHED' && (
        <p className="mb-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-500">
          Ce processus est publié : lecture seule. Créez un nouveau processus pour une nouvelle version.
        </p>
      )}

      <BpmnDesigner ref={designerRef} initialXml={process.bpmn_xml} readOnly={readOnly} roles={roles} users={users} />
    </div>
  );
}
