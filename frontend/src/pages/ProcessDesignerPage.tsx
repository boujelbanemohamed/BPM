import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, ShieldCheck, UploadCloud } from 'lucide-react';
import { api } from '../api/client';
import { MinimalUser, ProcessDefinition, Role } from '../types';
import { BpmnDesigner, BpmnDesignerHandle } from '../components/BpmnDesigner';
import { useAuth } from '../context/AuthContext';

const statusBadge: Record<string, string> = {
  DRAFT: 'bg-amber-100 text-amber-700',
  PUBLISHED: 'bg-emerald-100 text-emerald-700',
  ARCHIVED: 'bg-slate-200 text-slate-600',
};

export function ProcessDesignerPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [process, setProcess] = useState<ProcessDefinition | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [users, setUsers] = useState<MinimalUser[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const designerRef = useRef<BpmnDesignerHandle>(null);

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

  if (!process) return <div className="p-6 text-slate-400">Chargement…</div>;

  const readOnly = process.status !== 'DRAFT' || !isAdmin;

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
              {process.status}
            </span>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {status && <span className="text-sm text-slate-400">{status}</span>}
          {isAdmin && (
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
