import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import BpmnModeler from 'bpmn-js/lib/Modeler';
import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer';
import { Plus, Trash2 } from 'lucide-react';
import bpmPlatformModdle from '../bpmn/bpmPlatformModdle.json';
import { FormField, MinimalUser, Role } from '../types';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn.css';
import 'bpmn-js/dist/assets/bpmn-js.css';

export interface BpmnDesignerHandle {
  getXml: () => Promise<string>;
}

interface Props {
  initialXml: string;
  readOnly: boolean;
  roles: Role[];
  users: MinimalUser[];
}

let elementCounter = 0;
function nextId(prefix: string): string {
  elementCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${elementCounter}`;
}

function parseFormFields(raw: unknown): FormField[] {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FormField[]) : [];
  } catch {
    return [];
  }
}

export const BpmnDesigner = forwardRef<BpmnDesignerHandle, Props>(function BpmnDesigner(
  { initialXml, readOnly, roles, users },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const modelerRef = useRef<any>(null);
  const [selected, setSelected] = useState<any>(null);
  const [, forceRerender] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({
    getXml: async () => {
      if (!modelerRef.current) return initialXml;
      const { xml } = await modelerRef.current.saveXML({ format: true });
      return xml as string;
    },
  }));

  useEffect(() => {
    if (!containerRef.current) return;

    const ModelerClass = readOnly ? NavigatedViewer : BpmnModeler;
    const modeler = new ModelerClass({
      container: containerRef.current,
      moddleExtensions: { bpm: bpmPlatformModdle },
    });
    modelerRef.current = modeler;
    let cancelled = false;

    modeler
      .importXML(initialXml)
      .then(() => {
        if (cancelled) return;
        const canvas = modeler.get('canvas');
        canvas.zoom('fit-viewport');
      })
      .catch((err: Error) => {
        if (!cancelled) setError(`Impossible de charger le diagramme BPMN : ${err.message}`);
      });

    if (!readOnly) {
      const eventBus = modeler.get('eventBus');
      const onSelectionChanged = (e: any) => {
        if (!cancelled) setSelected(e.newSelection[0] ?? null);
      };
      const onElementChanged = () => {
        if (!cancelled) forceRerender((n) => n + 1);
      };
      eventBus.on('selection.changed', onSelectionChanged);
      eventBus.on('element.changed', onElementChanged);
    }

    return () => {
      cancelled = true;
      modeler.destroy();
      if (modelerRef.current === modeler) modelerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialXml, readOnly]);

  function addElement(bpmnType: string, label: string) {
    const modeler = modelerRef.current;
    if (!modeler) return;
    const modeling = modeler.get('modeling');
    const elementFactory = modeler.get('elementFactory');
    const canvas = modeler.get('canvas');
    const rootElement = canvas.getRootElement();

    const shape = elementFactory.createShape({ type: bpmnType });
    const viewbox = canvas.viewbox();
    const position = {
      x: Math.round(viewbox.x + viewbox.width / 2),
      y: Math.round(viewbox.y + viewbox.height / 2 + (Math.random() * 80 - 40)),
    };
    modeling.createShape(shape, position, rootElement);
    modeling.updateProperties(shape, { name: label, id: nextId(bpmnType.split(':')[1]) });
    setSelected(shape);
  }

  return (
    <div className="flex h-[calc(100vh-190px)] overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-1 flex-col">
        {!readOnly && (
          <div className="flex flex-wrap gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
            <ToolbarButton onClick={() => addElement('bpmn:UserTask', 'Nouvelle tâche')}>+ Tâche utilisateur</ToolbarButton>
            <ToolbarButton onClick={() => addElement('bpmn:ExclusiveGateway', 'Décision')}>+ Passerelle exclusive</ToolbarButton>
            <ToolbarButton onClick={() => addElement('bpmn:EndEvent', 'Fin')}>+ Événement de fin</ToolbarButton>
            <span className="ml-2 self-center text-xs text-slate-400">
              Utilisez la palette à gauche du canevas pour dessiner les transitions entre les éléments.
            </span>
          </div>
        )}
        {error && <p className="bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <div ref={containerRef} className="relative flex-1" />
      </div>
      {!readOnly && (
        <div className="w-80 overflow-y-auto border-l border-slate-200 bg-white p-4">
          {!selected && <p className="text-sm text-slate-400">Sélectionnez un élément du diagramme pour le configurer.</p>}
          {selected && (
            <ElementPanel key={selected.id} element={selected} modelerRef={modelerRef} roles={roles} users={users} />
          )}
        </div>
      )}
    </div>
  );
});

function ToolbarButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
    >
      <Plus size={13} /> {children}
    </button>
  );
}

function ElementPanel({
  element,
  modelerRef,
  roles,
  users,
}: {
  element: any;
  modelerRef: React.MutableRefObject<any>;
  roles: Role[];
  users: MinimalUser[];
}) {
  const bo = element.businessObject;
  const type = element.type as string;

  function updateProps(props: Record<string, unknown>) {
    const modeling = modelerRef.current.get('modeling');
    modeling.updateProperties(element, props);
  }

  if (type === 'bpmn:SequenceFlow') {
    return <SequenceFlowPanel element={element} modelerRef={modelerRef} />;
  }

  if (type === 'bpmn:UserTask') {
    return <UserTaskPanel bo={bo} onChange={updateProps} roles={roles} users={users} />;
  }

  if (type === 'bpmn:Task') {
    return (
      <div className="text-sm text-slate-600">
        <p className="mb-2 font-semibold">Tâche générique</p>
        <p>
          Utilisez le menu contextuel (icône clé à molette) sur l'élément sélectionné dans le canevas pour la
          transformer en <strong>Tâche utilisateur</strong>, puis configurez son assignation ici.
        </p>
      </div>
    );
  }

  if (type === 'bpmn:StartEvent') {
    return <StartEventPanel bo={bo} onChange={updateProps} />;
  }

  if (type === 'bpmn:EndEvent' || type === 'bpmn:ExclusiveGateway') {
    return (
      <div>
        <p className="mb-2 text-xs font-semibold uppercase text-slate-400">
          {type === 'bpmn:EndEvent' ? 'Événement de fin' : 'Passerelle exclusive'}
        </p>
        <Field label="Libellé">
          <input
            className="input"
            defaultValue={bo.name ?? ''}
            onBlur={(e) => updateProps({ name: e.target.value })}
          />
        </Field>
      </div>
    );
  }

  return <p className="text-sm text-slate-400">Type d'élément non configurable : {type}</p>;
}

function UserTaskPanel({
  bo,
  onChange,
  roles,
  users,
}: {
  bo: any;
  onChange: (props: Record<string, unknown>) => void;
  roles: Role[];
  users: MinimalUser[];
}) {
  const [fields, setFields] = useState<FormField[]>(parseFormFields(bo.formFields));

  function commitFields(next: FormField[]) {
    setFields(next);
    onChange({ formFields: JSON.stringify(next) });
  }

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold uppercase text-slate-400">Tâche utilisateur</p>
      <Field label="Libellé">
        <input className="input" defaultValue={bo.name ?? ''} onBlur={(e) => onChange({ name: e.target.value })} />
      </Field>
      <Field label="Rôle assigné (pool de traitement)">
        <select
          className="input"
          defaultValue={bo.assigneeRole ?? ''}
          onChange={(e) => onChange({ assigneeRole: e.target.value || undefined })}
        >
          <option value="">— aucun —</option>
          {roles.map((r) => (
            <option key={r.id} value={r.name}>
              {r.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Assigné nominatif (suppléance à 2 niveaux si absent)">
        <select
          className="input"
          defaultValue={bo.assigneeUserId ?? ''}
          onChange={(e) => onChange({ assigneeUserId: e.target.value || undefined })}
        >
          <option value="">— aucun (pool de rôle uniquement) —</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.fullName} ({u.roles.join(', ')})
            </option>
          ))}
        </select>
      </Field>

      <FormFieldsEditor fields={fields} onChange={commitFields} label="Formulaire de la tâche" />
    </div>
  );
}

function StartEventPanel({ bo, onChange }: { bo: any; onChange: (props: Record<string, unknown>) => void }) {
  const [fields, setFields] = useState<FormField[]>(parseFormFields(bo.formFields));

  function commitFields(next: FormField[]) {
    setFields(next);
    onChange({ formFields: JSON.stringify(next) });
  }

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold uppercase text-slate-400">Événement de début</p>
      <Field label="Libellé">
        <input className="input" defaultValue={bo.name ?? ''} onBlur={(e) => onChange({ name: e.target.value })} />
      </Field>
      <p className="text-xs text-slate-500">
        Ces champs sont demandés à la personne qui démarre une instance (ex : nom du client, référence dossier). Ils
        apparaîtront ensuite dans "Mes tâches" et la liste des instances pour identifier le dossier.
      </p>
      <FormFieldsEditor fields={fields} onChange={commitFields} label="Formulaire de démarrage" />
    </div>
  );
}

function FormFieldsEditor({
  fields,
  onChange,
  label,
}: {
  fields: FormField[];
  onChange: (next: FormField[]) => void;
  label: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        <button
          type="button"
          onClick={() => onChange([...fields, { key: '', label: '', type: 'text', required: false }])}
          className="text-xs font-semibold text-brand-600 hover:underline"
        >
          + Champ
        </button>
      </div>
      <div className="space-y-2">
        {fields.map((f, i) => (
          <div key={i} className="flex items-center gap-1 rounded-lg border border-slate-200 p-1.5">
            <input
              className="input min-w-0 flex-1 text-xs"
              placeholder="clé"
              value={f.key}
              onChange={(e) => onChange(fields.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
            />
            <input
              className="input min-w-0 flex-1 text-xs"
              placeholder="libellé"
              value={f.label}
              onChange={(e) => onChange(fields.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
            />
            <select
              className="input w-20 text-xs"
              value={f.type}
              onChange={(e) =>
                onChange(fields.map((x, j) => (j === i ? { ...x, type: e.target.value as FormField['type'] } : x)))
              }
            >
              <option value="text">texte</option>
              <option value="number">nombre</option>
              <option value="boolean">oui/non</option>
              <option value="date">date</option>
              <option value="textarea">zone texte</option>
              <option value="client">client</option>
            </select>
            <input
              type="checkbox"
              title="obligatoire"
              checked={f.required}
              onChange={(e) => onChange(fields.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)))}
            />
            <button type="button" onClick={() => onChange(fields.filter((_, j) => j !== i))}>
              <Trash2 size={14} className="text-rose-500" />
            </button>
          </div>
        ))}
        {fields.length === 0 && <p className="text-xs text-slate-400">Aucun champ défini.</p>}
      </div>
    </div>
  );
}

function SequenceFlowPanel({ element, modelerRef }: { element: any; modelerRef: React.MutableRefObject<any> }) {
  const bo = element.businessObject;
  const existingCondition: string | undefined = bo.conditionExpression?.body;
  const [hasCondition, setHasCondition] = useState(Boolean(existingCondition));
  const [expression, setExpression] = useState(existingCondition ?? '');

  const source = element.source;
  const isFromGateway = source?.type === 'bpmn:ExclusiveGateway';
  const isDefault = isFromGateway && source.businessObject.default === bo;

  function applyCondition(next: string, enabled: boolean) {
    const modeler = modelerRef.current;
    const modeling = modeler.get('modeling');
    const bpmnFactory = modeler.get('bpmnFactory');

    if (!enabled) {
      modeling.updateProperties(element, { conditionExpression: undefined });
      return;
    }
    const formalExpression = bpmnFactory.create('bpmn:FormalExpression', { body: next });
    modeling.updateProperties(element, { conditionExpression: formalExpression });
  }

  function toggleDefault(checked: boolean) {
    const modeler = modelerRef.current;
    const modeling = modeler.get('modeling');
    modeling.updateProperties(source, { default: checked ? bo : undefined });
  }

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold uppercase text-slate-400">Transition</p>
      <p className="text-xs text-slate-500">
        {source?.businessObject?.name ?? source?.id} → {element.target?.businessObject?.name ?? element.target?.id}
      </p>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={hasCondition}
          onChange={(e) => {
            setHasCondition(e.target.checked);
            applyCondition(expression, e.target.checked);
          }}
        />
        A une condition (sinon transition par défaut)
      </label>

      {hasCondition && (
        <Field label="Expression (ex : approved == true)">
          <input
            className="input"
            value={expression}
            onChange={(e) => setExpression(e.target.value)}
            onBlur={() => applyCondition(expression, true)}
            placeholder="champ == valeur"
          />
        </Field>
      )}

      {isFromGateway && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isDefault} onChange={(e) => toggleDefault(e.target.checked)} />
          Flux par défaut de la passerelle
        </label>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}
