import { useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Users } from 'lucide-react';
import { api } from '../api/client';
import { FormField, TaskItem } from '../types';

function FieldInput({ field, value, onChange }: { field: FormField; value: unknown; onChange: (v: unknown) => void }) {
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

function TaskForm({ task, onDone }: { task: TaskItem; onDone: () => void }) {
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    for (const field of task.form_schema) {
      const value = formData[field.key];
      if (field.required && (value === undefined || value === '')) {
        setError(`Le champ "${field.label}" est obligatoire`);
        return;
      }
    }
    setBusy(true);
    try {
      await api.completeTask(task.id, formData);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      {task.form_schema.map((field) => (
        <label key={field.key} className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">
            {field.label}
            {field.required ? ' *' : ''}
          </span>
          <FieldInput
            field={field}
            value={formData[field.key]}
            onChange={(v) => setFormData((prev) => ({ ...prev, [field.key]: v }))}
          />
        </label>
      ))}
      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <button onClick={submit} disabled={busy} className="btn-primary">
        <CheckCircle2 size={16} /> {busy ? 'Validation…' : 'Valider la tâche'}
      </button>
    </div>
  );
}

export function TasksPage() {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  async function refresh() {
    const { tasks } = await api.myTasks();
    setTasks(tasks);
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="mb-6 text-2xl font-bold text-slate-800">Mes tâches</h1>
      <div className="space-y-3">
        {tasks.map((task) => (
          <div key={task.id} className="card">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-slate-800">{task.step_name}</span>
                  {task.is_delegated && (
                    <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                      <Users size={12} /> Reçue par suppléance
                    </span>
                  )}
                  {task.is_pool_task && !task.is_delegated && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">
                      Pool {task.role_name}
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-400">Processus : {task.process_name}</p>
              </div>
              <button
                onClick={() => setOpenTaskId(openTaskId === task.id ? null : task.id)}
                className="btn-secondary"
              >
                {openTaskId === task.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                {openTaskId === task.id ? 'Fermer' : 'Traiter'}
              </button>
            </div>
            {openTaskId === task.id && (
              <TaskForm
                task={task}
                onDone={() => {
                  setOpenTaskId(null);
                  refresh();
                }}
              />
            )}
          </div>
        ))}
        {tasks.length === 0 && <div className="card text-center text-slate-400">Aucune tâche en attente.</div>}
      </div>
    </div>
  );
}
