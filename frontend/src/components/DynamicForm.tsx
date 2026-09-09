import { useState } from 'react';
import { FormField } from '../types';
import { ClientPicker } from './ClientPicker';

export function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (field.type === 'client') {
    return <ClientPicker value={value} onChange={onChange} />;
  }
  if (field.type === 'boolean') {
    return (
      <select
        className="input"
        value={value === true ? 'true' : value === false ? 'false' : ''}
        onChange={(e) => onChange(e.target.value === 'true')}
      >
        <option value="" disabled>
          Choisir…
        </option>
        <option value="true">Oui</option>
        <option value="false">Non</option>
      </select>
    );
  }
  if (field.type === 'number') {
    return (
      <input
        type="number"
        className="input"
        value={(value as number | undefined) ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      />
    );
  }
  if (field.type === 'date') {
    return (
      <input type="date" className="input" value={(value as string | undefined) ?? ''} onChange={(e) => onChange(e.target.value)} />
    );
  }
  if (field.type === 'textarea') {
    return (
      <textarea
        className="input"
        rows={3}
        value={(value as string | undefined) ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return <input type="text" className="input" value={(value as string | undefined) ?? ''} onChange={(e) => onChange(e.target.value)} />;
}

export function DynamicForm({
  fields,
  onSubmit,
  submitLabel,
  busy,
}: {
  fields: FormField[];
  onSubmit: (formData: Record<string, unknown>) => Promise<void> | void;
  submitLabel: string;
  busy?: boolean;
}) {
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    for (const field of fields) {
      const value = formData[field.key];
      if (field.required && (value === undefined || value === '')) {
        setError(`Le champ "${field.label}" est obligatoire`);
        return;
      }
    }
    await onSubmit(formData);
  }

  return (
    <div className="space-y-3">
      {fields.map((field) => (
        <label key={field.key} className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">
            {field.label}
            {field.required ? ' *' : ''}
          </span>
          <FieldInput field={field} value={formData[field.key]} onChange={(v) => setFormData((prev) => ({ ...prev, [field.key]: v }))} />
        </label>
      ))}
      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <button onClick={submit} disabled={busy} className="btn-primary">
        {busy ? 'Envoi…' : submitLabel}
      </button>
    </div>
  );
}

/** Affiche compactement les données visibles d'un dossier (ex : "Client: Dupont SA · Référence: DOS-004"). */
export function ContextLine({ data }: { data: Record<string, unknown> | undefined | null }) {
  const entries = Object.entries(data ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (entries.length === 0) return null;
  return (
    <p className="text-sm text-slate-500">
      {entries.map(([key, value], i) => (
        <span key={key}>
          {i > 0 && <span className="mx-1.5 text-slate-300">·</span>}
          <span className="text-slate-400">{key} :</span> {String(value)}
        </span>
      ))}
    </p>
  );
}

/** Extrait les champs bpm:formFields d'un élément BPMN donné (userTask ou startEvent) côté client. */
export function extractFormFields(bpmnXml: string, tagName: 'userTask' | 'startEvent', elementId?: string): FormField[] {
  const doc = new DOMParser().parseFromString(bpmnXml, 'application/xml');
  const nodes = Array.from(doc.getElementsByTagName(`bpmn:${tagName}`));
  const target = elementId ? nodes.find((n) => n.getAttribute('id') === elementId) : nodes[0];
  const raw = target?.getAttribute('bpm:formFields');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FormField[]) : [];
  } catch {
    return [];
  }
}
