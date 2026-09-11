import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, GitCompare } from 'lucide-react';
import { api } from '../api/client';
import { ProcessDefinition } from '../types';
import { BpmnDiffViewer } from '../components/BpmnDiffViewer';

export function ProcessDiffPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const [process, setProcess] = useState<ProcessDefinition | null>(null);
  const [versions, setVersions] = useState<ProcessDefinition[]>([]);
  const [oldVersionId, setOldVersionId] = useState('');
  const [newVersionId, setNewVersionId] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const { process: current } = await api.getProcess(id);
        const { processes: sameKey } = await api.listProcesses({ processKey: current.process_key });
        const published = sameKey.filter((p) => p.status === 'PUBLISHED').sort((a, b) => a.version - b.version);

        setProcess(current);
        setVersions(published);

        const currentIndex = published.findIndex((p) => p.id === current.id);
        const previous = published[currentIndex - 1] ?? published[0];
        setOldVersionId(previous?.id ?? '');
        setNewVersionId(current.id);
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, [id]);

  const oldVersion = versions.find((v) => v.id === oldVersionId);
  const newVersion = versions.find((v) => v.id === newVersionId);

  if (error) return <div className="p-6 text-rose-600">{error}</div>;
  if (!process) return <div className="p-6 text-slate-400">{t('designer.loading')}</div>;

  return (
    <div className="mx-auto max-w-7xl p-6">
      <Link to={`/processes/${process.id}`} className="mb-1 flex items-center gap-1 text-sm text-slate-500 hover:text-brand-600">
        <ArrowLeft size={14} /> {t('diff.backToProcess')}
      </Link>
      <h1 className="mb-4 flex items-center gap-2 text-xl font-bold text-slate-800">
        <GitCompare size={20} /> {t('diff.title', { name: process.name })}
      </h1>

      {versions.length < 2 ? (
        <div className="card text-slate-400">{t('diff.needTwoVersions')}</div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3 card">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              {t('diff.oldVersion')}
              <select
                value={oldVersionId}
                onChange={(e) => setOldVersionId(e.target.value)}
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
              >
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    v{v.version}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              {t('diff.newVersion')}
              <select
                value={newVersionId}
                onChange={(e) => setNewVersionId(e.target.value)}
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
              >
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    v{v.version}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {oldVersion && newVersion && (
            oldVersion.id === newVersion.id ? (
              <div className="card text-slate-400">{t('diff.sameVersion')}</div>
            ) : (
              <BpmnDiffViewer
                oldXml={oldVersion.bpmn_xml}
                oldLabel={`v${oldVersion.version}`}
                newXml={newVersion.bpmn_xml}
                newLabel={`v${newVersion.version}`}
              />
            )
          )}
        </>
      )}
    </div>
  );
}
