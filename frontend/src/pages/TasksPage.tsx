import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Users } from 'lucide-react';
import { api } from '../api/client';
import { TaskItem } from '../types';
import { ContextLine, DynamicForm } from '../components/DynamicForm';

export function TasksPage() {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const { tasks } = await api.myTasks();
    setTasks(tasks);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function complete(taskId: string, formData: Record<string, unknown>) {
    setBusy(true);
    try {
      await api.completeTask(taskId, formData);
      setOpenTaskId(null);
      refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="mb-6 text-2xl font-bold text-slate-800">{t('tasks.title')}</h1>
      <div className="space-y-3">
        {tasks.map((task) => (
          <div key={task.id} className="card">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-slate-800">{task.step_name}</span>
                  {task.is_delegated && (
                    <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                      <Users size={12} /> {t('tasks.delegated')}
                    </span>
                  )}
                  {task.is_pool_task && !task.is_delegated && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">
                      {t('tasks.pool', { role: task.role_name })}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400">{t('tasks.process', { name: task.process_name })}</p>
                <ContextLine data={task.instance_form_data} />
              </div>
              <button
                onClick={() => setOpenTaskId(openTaskId === task.id ? null : task.id)}
                className="btn-secondary"
              >
                {openTaskId === task.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                {openTaskId === task.id ? t('tasks.close') : t('tasks.handle')}
              </button>
            </div>
            {openTaskId === task.id && (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <DynamicForm
                  fields={task.form_schema}
                  submitLabel={t('tasks.submit')}
                  busy={busy}
                  onSubmit={(formData) => complete(task.id, formData)}
                />
              </div>
            )}
          </div>
        ))}
        {tasks.length === 0 && <div className="card text-center text-slate-400">{t('tasks.empty')}</div>}
      </div>
    </div>
  );
}
