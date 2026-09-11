import { useEffect, useRef, useState } from 'react';
import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer';
import bpmPlatformModdle from '../bpmn/bpmPlatformModdle.json';
import { frTranslationsModule } from '../bpmn/frTranslations';
import { computeBpmnDiff } from '../lib/bpmnDiff';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn.css';
import 'bpmn-js/dist/assets/bpmn-js.css';

interface Props {
  oldXml: string;
  oldLabel: string;
  newXml: string;
  newLabel: string;
}

function useNavigatedViewer(xml: string) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const viewer = new NavigatedViewer({
      container: containerRef.current,
      moddleExtensions: { bpm: bpmPlatformModdle },
      additionalModules: [frTranslationsModule],
    });
    viewerRef.current = viewer;
    let cancelled = false;

    viewer
      .importXML(xml)
      .then(() => {
        if (cancelled) return;
        viewer.get('canvas').zoom('fit-viewport');
        setReady(true);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(`Impossible de charger le diagramme BPMN : ${err.message}`);
      });

    return () => {
      cancelled = true;
      viewer.destroy();
      if (viewerRef.current === viewer) viewerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xml]);

  return { containerRef, viewerRef, error, ready };
}

/**
 * Vue côte à côte de deux versions d'un diagramme BPMN, avec les
 * différences colorées (calculées via bpmn-js-differ) : vert pour les
 * éléments ajoutés dans la nouvelle version, rouge pour ceux supprimés
 * depuis l'ancienne, orange pour ceux présents dans les deux mais modifiés.
 */
export function BpmnDiffViewer({ oldXml, oldLabel, newXml, newLabel }: Props) {
  const oldViewer = useNavigatedViewer(oldXml);
  const newViewer = useNavigatedViewer(newXml);
  const [summary, setSummary] = useState<{ added: number; removed: number; changed: number } | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);

  useEffect(() => {
    if (!oldViewer.ready || !newViewer.ready) return;
    let cancelled = false;

    computeBpmnDiff(oldXml, newXml)
      .then(({ addedIds, removedIds, changedIds }) => {
        if (cancelled) return;

        const oldCanvas = oldViewer.viewerRef.current?.get('canvas');
        const newCanvas = newViewer.viewerRef.current?.get('canvas');
        if (!oldCanvas || !newCanvas) return;

        for (const id of addedIds) {
          newCanvas.addMarker(id, 'bpmn-diff-added');
        }
        for (const id of removedIds) {
          oldCanvas.addMarker(id, 'bpmn-diff-removed');
        }
        for (const id of changedIds) {
          oldCanvas.addMarker(id, 'bpmn-diff-changed');
          newCanvas.addMarker(id, 'bpmn-diff-changed');
        }

        setSummary({ added: addedIds.length, removed: removedIds.length, changed: changedIds.length });
      })
      .catch((err: Error) => {
        if (!cancelled) setDiffError(`Impossible de calculer les différences : ${err.message}`);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oldViewer.ready, newViewer.ready, oldXml, newXml]);

  return (
    <div>
      <style>{`
        .bpmn-diff-added .djs-visual > :first-child { stroke: #16a34a !important; stroke-width: 2.5px !important; fill: #dcfce7 !important; fill-opacity: 0.6 !important; }
        .bpmn-diff-removed .djs-visual > :first-child { stroke: #dc2626 !important; stroke-width: 2.5px !important; fill: #fee2e2 !important; fill-opacity: 0.6 !important; }
        .bpmn-diff-changed .djs-visual > :first-child { stroke: #ea580c !important; stroke-width: 2.5px !important; fill: #ffedd5 !important; fill-opacity: 0.5 !important; }
        .bpmn-diff-added .djs-visual > path, .bpmn-diff-removed .djs-visual > path, .bpmn-diff-changed .djs-visual > path { fill: none !important; }
      `}</style>

      {summary && (
        <div className="mb-3 flex items-center gap-4 rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <span className="flex items-center gap-1.5 text-emerald-700">
            <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> {summary.added} ajouté(s)
          </span>
          <span className="flex items-center gap-1.5 text-rose-700">
            <span className="h-2.5 w-2.5 rounded-sm bg-rose-500" /> {summary.removed} supprimé(s)
          </span>
          <span className="flex items-center gap-1.5 text-orange-700">
            <span className="h-2.5 w-2.5 rounded-sm bg-orange-500" /> {summary.changed} modifié(s)
          </span>
        </div>
      )}
      {diffError && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{diffError}</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">{oldLabel}</div>
          {oldViewer.error && <p className="bg-rose-50 px-3 py-2 text-sm text-rose-700">{oldViewer.error}</p>}
          <div ref={oldViewer.containerRef} className="h-[60vh]" />
        </div>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">{newLabel}</div>
          {newViewer.error && <p className="bg-rose-50 px-3 py-2 text-sm text-rose-700">{newViewer.error}</p>}
          <div ref={newViewer.containerRef} className="h-[60vh]" />
        </div>
      </div>
    </div>
  );
}
