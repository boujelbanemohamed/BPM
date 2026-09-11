import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import BpmnModeler from 'bpmn-js/lib/Modeler';
import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer';
import { Plus, Trash2 } from 'lucide-react';
import bpmPlatformModdle from '../bpmn/bpmPlatformModdle.json';
import { frTranslationsModule } from '../bpmn/frTranslations';
import { FormField, MinimalUser, Role } from '../types';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn.css';
import 'bpmn-js/dist/assets/bpmn-js.css';

export interface BpmnDesignerHandle {
  getXml: () => Promise<string>;
  getSvg: () => Promise<string>;
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
  const { t } = useTranslation();
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
    getSvg: async () => {
      if (!modelerRef.current) return '';
      const { svg } = await modelerRef.current.saveSVG();
      return svg as string;
    },
  }));

  useEffect(() => {
    if (!containerRef.current) return;

    const ModelerClass = readOnly ? NavigatedViewer : BpmnModeler;
    const modeler = new ModelerClass({
      container: containerRef.current,
      moddleExtensions: { bpm: bpmPlatformModdle },
      additionalModules: [frTranslationsModule],
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
        if (!cancelled) setError(t('diff.loadError', { message: err.message }));
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
            <ToolbarButton onClick={() => addElement('bpmn:UserTask', 'Nouvelle tâche')}>{t('bpmnDesigner.toolbar.addUserTask')}</ToolbarButton>
            <ToolbarButton onClick={() => addElement('bpmn:ExclusiveGateway', 'Décision')}>{t('bpmnDesigner.toolbar.addExclusiveGateway')}</ToolbarButton>
            <ToolbarButton onClick={() => addElement('bpmn:ParallelGateway', 'Parallèle')}>{t('bpmnDesigner.toolbar.addParallelGateway')}</ToolbarButton>
            <ToolbarButton onClick={() => addElement('bpmn:InclusiveGateway', 'Inclusive')}>{t('bpmnDesigner.toolbar.addInclusiveGateway')}</ToolbarButton>
            <ToolbarButton onClick={() => addElement('bpmn:EndEvent', 'Fin')}>{t('bpmnDesigner.toolbar.addEndEvent')}</ToolbarButton>
            <span className="ml-2 self-center text-xs text-slate-400">{t('bpmnDesigner.toolbar.paletteHint')}</span>
          </div>
        )}
        {error && <p className="bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <div ref={containerRef} className="relative flex-1" />
      </div>
      {!readOnly && (
        <div className="w-80 overflow-y-auto border-l border-slate-200 bg-white p-4">
          {!selected && <p className="text-sm text-slate-400">{t('bpmnDesigner.noSelection')}</p>}
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
  const { t } = useTranslation();
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
        <p className="mb-2 font-semibold">{t('bpmnDesigner.genericTaskTitle')}</p>
        <p>
          {t('bpmnDesigner.genericTaskHintBefore')} <strong>{t('bpmnDesigner.userTaskTitle')}</strong>
          {t('bpmnDesigner.genericTaskHintAfter')}
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
          {type === 'bpmn:EndEvent' ? t('bpmnDesigner.endEventTitle') : t('bpmnDesigner.exclusiveGatewayTitle')}
        </p>
        <Field label={t('bpmnDesigner.fieldLabel')}>
          <input
            className="input"
            defaultValue={bo.name ?? ''}
            onBlur={(e) => updateProps({ name: e.target.value })}
          />
        </Field>
      </div>
    );
  }

  if (type === 'bpmn:ParallelGateway') {
    const incomingCount = element.incoming?.length ?? 0;
    const outgoingCount = element.outgoing?.length ?? 0;
    return (
      <div>
        <p className="mb-2 text-xs font-semibold uppercase text-slate-400">{t('bpmnDesigner.parallelGatewayTitle')}</p>
        <Field label={t('bpmnDesigner.fieldLabel')}>
          <input
            className="input"
            defaultValue={bo.name ?? ''}
            onBlur={(e) => updateProps({ name: e.target.value })}
          />
        </Field>
        <p className="mt-3 text-xs text-slate-500">
          {outgoingCount > 1 && t('bpmnDesigner.parallelForkText', { count: outgoingCount })}
          {incomingCount > 1 && t('bpmnDesigner.parallelJoinText', { count: incomingCount })}
          {incomingCount <= 1 && outgoingCount <= 1 && t('bpmnDesigner.parallelNeitherText')}
        </p>
      </div>
    );
  }

  if (type === 'bpmn:InclusiveGateway') {
    return (
      <div>
        <p className="mb-2 text-xs font-semibold uppercase text-slate-400">{t('bpmnDesigner.inclusiveGatewayTitle')}</p>
        <Field label={t('bpmnDesigner.fieldLabel')}>
          <input
            className="input"
            defaultValue={bo.name ?? ''}
            onBlur={(e) => updateProps({ name: e.target.value })}
          />
        </Field>
        <p className="mt-3 text-xs text-slate-500">{t('bpmnDesigner.inclusiveGatewayHint')}</p>
      </div>
    );
  }

  return <p className="text-sm text-slate-400">{t('bpmnDesigner.unconfigurableType', { type })}</p>;
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
  const { t } = useTranslation();
  const [fields, setFields] = useState<FormField[]>(parseFormFields(bo.formFields));

  function commitFields(next: FormField[]) {
    setFields(next);
    onChange({ formFields: JSON.stringify(next) });
  }

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold uppercase text-slate-400">{t('bpmnDesigner.userTaskTitle')}</p>
      <Field label={t('bpmnDesigner.fieldLabel')}>
        <input className="input" defaultValue={bo.name ?? ''} onBlur={(e) => onChange({ name: e.target.value })} />
      </Field>
      <Field label={t('bpmnDesigner.assignedRole')}>
        <select
          className="input"
          defaultValue={bo.assigneeRole ?? ''}
          onChange={(e) => onChange({ assigneeRole: e.target.value || undefined })}
        >
          <option value="">{t('bpmnDesigner.noneOption')}</option>
          {roles.map((r) => (
            <option key={r.id} value={r.name}>
              {r.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('bpmnDesigner.assignedUser')}>
        <select
          className="input"
          defaultValue={bo.assigneeUserId ?? ''}
          onChange={(e) => onChange({ assigneeUserId: e.target.value || undefined })}
        >
          <option value="">{t('bpmnDesigner.noneRoleOnlyOption')}</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.fullName} ({u.roles.join(', ')})
            </option>
          ))}
        </select>
      </Field>

      <FormFieldsEditor fields={fields} onChange={commitFields} label={t('bpmnDesigner.taskFormLabel')} />
    </div>
  );
}

function StartEventPanel({ bo, onChange }: { bo: any; onChange: (props: Record<string, unknown>) => void }) {
  const { t } = useTranslation();
  const [fields, setFields] = useState<FormField[]>(parseFormFields(bo.formFields));

  function commitFields(next: FormField[]) {
    setFields(next);
    onChange({ formFields: JSON.stringify(next) });
  }

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold uppercase text-slate-400">{t('bpmnDesigner.startEventTitle')}</p>
      <Field label={t('bpmnDesigner.fieldLabel')}>
        <input className="input" defaultValue={bo.name ?? ''} onBlur={(e) => onChange({ name: e.target.value })} />
      </Field>
      <p className="text-xs text-slate-500">{t('bpmnDesigner.startEventHint')}</p>
      <FormFieldsEditor fields={fields} onChange={commitFields} label={t('bpmnDesigner.startFormLabel')} />
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
  const { t } = useTranslation();
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        <button
          type="button"
          onClick={() => onChange([...fields, { key: '', label: '', type: 'text', required: false }])}
          className="text-xs font-semibold text-brand-600 hover:underline"
        >
          {t('bpmnDesigner.addFieldButton')}
        </button>
      </div>
      <div className="space-y-2">
        {fields.map((f, i) => (
          <div key={i} className="flex items-center gap-1 rounded-lg border border-slate-200 p-1.5">
            <input
              className="input min-w-0 flex-1 text-xs"
              placeholder={t('bpmnDesigner.fieldKeyPlaceholder') as string}
              value={f.key}
              onChange={(e) => onChange(fields.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
            />
            <input
              className="input min-w-0 flex-1 text-xs"
              placeholder={t('bpmnDesigner.fieldLabelPlaceholder') as string}
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
              <option value="text">{t('bpmnDesigner.fieldTypes.text')}</option>
              <option value="number">{t('bpmnDesigner.fieldTypes.number')}</option>
              <option value="boolean">{t('bpmnDesigner.fieldTypes.boolean')}</option>
              <option value="date">{t('bpmnDesigner.fieldTypes.date')}</option>
              <option value="textarea">{t('bpmnDesigner.fieldTypes.textarea')}</option>
              <option value="client">{t('bpmnDesigner.fieldTypes.client')}</option>
            </select>
            <input
              type="checkbox"
              title={t('bpmnDesigner.requiredTitle') as string}
              checked={f.required}
              onChange={(e) => onChange(fields.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)))}
            />
            <button type="button" onClick={() => onChange(fields.filter((_, j) => j !== i))}>
              <Trash2 size={14} className="text-rose-500" />
            </button>
          </div>
        ))}
        {fields.length === 0 && <p className="text-xs text-slate-400">{t('bpmnDesigner.noFieldsDefined')}</p>}
      </div>
    </div>
  );
}

function SequenceFlowPanel({ element, modelerRef }: { element: any; modelerRef: React.MutableRefObject<any> }) {
  const { t } = useTranslation();
  const bo = element.businessObject;
  const existingCondition: string | undefined = bo.conditionExpression?.body;
  const [hasCondition, setHasCondition] = useState(Boolean(existingCondition));
  const [expression, setExpression] = useState(existingCondition ?? '');

  const source = element.source;
  const isFromExclusiveGateway = source?.type === 'bpmn:ExclusiveGateway';
  const isFromInclusiveGateway = source?.type === 'bpmn:InclusiveGateway';
  const isFromParallelGateway = source?.type === 'bpmn:ParallelGateway';
  // L'exclusive ET l'inclusive évaluent des conditions sur leurs transitions
  // sortantes (l'inclusive peut juste en activer plusieurs à la fois) ; la
  // parallèle, elle, les emprunte toutes sans condition (cf. ci-dessous).
  const isFromConditionalGateway = isFromExclusiveGateway || isFromInclusiveGateway;
  const isDefault = isFromConditionalGateway && source.businessObject.default === bo;

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
      <p className="text-xs font-semibold uppercase text-slate-400">{t('bpmnDesigner.transitionTitle')}</p>
      <p className="text-xs text-slate-500">
        {source?.businessObject?.name ?? source?.id} → {element.target?.businessObject?.name ?? element.target?.id}
      </p>

      {isFromParallelGateway ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">{t('bpmnDesigner.parallelTransitionHint')}</p>
      ) : (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={hasCondition}
              onChange={(e) => {
                setHasCondition(e.target.checked);
                applyCondition(expression, e.target.checked);
              }}
            />
            {t('bpmnDesigner.hasConditionLabel')}
          </label>
          {isFromInclusiveGateway && hasCondition && (
            <p className="text-xs text-slate-400">{t('bpmnDesigner.inclusiveConditionHint')}</p>
          )}

          {hasCondition && (
            <Field label={t('bpmnDesigner.expressionLabel')}>
              <input
                className="input"
                value={expression}
                onChange={(e) => setExpression(e.target.value)}
                onBlur={() => applyCondition(expression, true)}
                placeholder={t('bpmnDesigner.expressionPlaceholder') as string}
              />
            </Field>
          )}
        </>
      )}

      {isFromConditionalGateway && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isDefault} onChange={(e) => toggleDefault(e.target.checked)} />
          {t('bpmnDesigner.defaultFlowLabel')}
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
