import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, ClipboardList, PlayCircle, Users, Workflow, XCircle } from 'lucide-react';
import { api } from '../api/client';
import { DashboardSummary } from '../types';
import { formatDate, formatDateTime } from '../lib/dateFormat';

const STATUS_FILL: Record<string, string> = {
  RUNNING: 'fill-brand-500',
  COMPLETED: 'fill-emerald-500',
  CANCELLED: 'fill-rose-500',
};
const STATUS_DOT: Record<string, string> = {
  RUNNING: 'bg-brand-500',
  COMPLETED: 'bg-emerald-500',
  CANCELLED: 'bg-rose-500',
};

function KpiTile({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <div className="card flex items-center gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
        {icon}
      </div>
      <div>
        <div className="text-2xl font-bold text-slate-800">{value}</div>
        <div className="text-xs text-slate-500">{label}</div>
      </div>
    </div>
  );
}

function StatusBreakdownCard({ summary }: { summary: DashboardSummary }) {
  const { t } = useTranslation();
  const total = summary.statusBreakdown.reduce((sum, s) => sum + s.count, 0);

  return (
    <div className="card">
      <h2 className="mb-3 font-semibold text-slate-700">{t('dashboard.statusBreakdown.title')}</h2>
      {total === 0 ? (
        <p className="text-sm text-slate-400">{t('dashboard.statusBreakdown.empty')}</p>
      ) : (
        <>
          <svg viewBox="0 0 100 10" className="h-4 w-full" preserveAspectRatio="none">
            {(() => {
              let x = 0;
              return summary.statusBreakdown
                .filter((s) => s.count > 0)
                .map((s) => {
                  const width = (s.count / total) * 100;
                  const rect = (
                    <rect
                      key={s.status}
                      x={x}
                      y={0}
                      width={Math.max(width - 0.6, 0)}
                      height={10}
                      rx={2}
                      className={STATUS_FILL[s.status]}
                    />
                  );
                  x += width;
                  return rect;
                });
            })()}
          </svg>
          <ul className="mt-3 space-y-1.5">
            {summary.statusBreakdown.map((s) => (
              <li key={s.status} className="flex items-center gap-2 text-sm">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT[s.status]}`} />
                <span className="text-slate-600">{t(`dashboard.statusBreakdown.labels.${s.status}`)}</span>
                <span className="ml-auto font-semibold text-slate-800">{s.count}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function WeeklyVolumeCard({ summary }: { summary: DashboardSummary }) {
  const { t } = useTranslation();
  const max = Math.max(1, ...summary.weeklyVolume.map((w) => w.count));

  return (
    <div className="card">
      <h2 className="mb-3 font-semibold text-slate-700">{t('dashboard.weeklyVolume.title')}</h2>
      <div className="flex h-32 items-end gap-2">
        {summary.weeklyVolume.map((w) => {
          const heightPct = (w.count / max) * 100;
          const label = formatDate(`${w.weekStart}T00:00:00Z`, {
            day: 'numeric',
            month: 'short',
            timeZone: 'UTC',
          });
          return (
            <div key={w.weekStart} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex h-24 w-full items-end justify-center">
                <div
                  className="w-full max-w-[28px] rounded-t bg-brand-500"
                  style={{ height: `${Math.max(heightPct, w.count > 0 ? 4 : 0)}%` }}
                  title={`${w.count}`}
                />
              </div>
              <span className="text-[11px] font-semibold text-slate-500">{w.count}</span>
              <span className="text-[10px] text-slate-400">{label}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-slate-400">{t('dashboard.weeklyVolume.hint')}</p>
    </div>
  );
}

function MyTasksCard({ summary }: { summary: DashboardSummary }) {
  const { t } = useTranslation();
  return (
    <div className="card">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-semibold text-slate-700">
          <ClipboardList size={16} /> {t('dashboard.myTasks.title')}
        </h2>
        <Link to="/tasks" className="text-xs font-semibold text-brand-600 hover:underline">
          {t('dashboard.myTasks.viewAll')}
        </Link>
      </div>
      {summary.myTasks.length === 0 ? (
        <p className="text-sm text-slate-400">{t('dashboard.myTasks.empty')}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {summary.myTasks.map((task) => (
            <li key={task.id} className="py-2">
              <Link to={`/instances/${task.instanceId}`} className="block hover:bg-slate-50 rounded-lg px-1 -mx-1">
                <div className="text-sm font-medium text-slate-700">{task.stepName}</div>
                <div className="text-xs text-slate-400">{task.processName}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const ACTIVITY_ICON: Record<string, React.ReactNode> = {
  STARTED: <PlayCircle size={14} className="text-brand-600" />,
  COMPLETED: <CheckCircle2 size={14} className="text-emerald-600" />,
  CANCELLED: <XCircle size={14} className="text-rose-600" />,
};

function RecentActivityCard({ summary }: { summary: DashboardSummary }) {
  const { t } = useTranslation();
  return (
    <div className="card">
      <h2 className="mb-2 font-semibold text-slate-700">{t('dashboard.recentActivity.title')}</h2>
      {summary.recentActivity.length === 0 ? (
        <p className="text-sm text-slate-400">{t('dashboard.recentActivity.empty')}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {summary.recentActivity.map((item, idx) => (
            <li key={`${item.instanceId}-${item.event}-${idx}`} className="py-2">
              <Link
                to={`/instances/${item.instanceId}`}
                className="flex items-start gap-2 rounded-lg px-1 -mx-1 hover:bg-slate-50"
              >
                {ACTIVITY_ICON[item.event]}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-slate-700">
                    {t(`dashboard.recentActivity.events.${item.event}`, { process: item.processName })}
                  </div>
                  <div className="text-xs text-slate-400">
                    {item.actorName ?? t('dashboard.recentActivity.systemActor')} ·{' '}
                    {formatDateTime(item.at)}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DashboardPage() {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getDashboard()
      .then(setSummary)
      .catch((err) => setError((err as Error).message));
  }, []);

  if (error) return <p className="p-6 text-sm text-rose-600">{error}</p>;
  if (!summary) return <div className="p-6 text-slate-400">{t('designer.loading')}</div>;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <h1 className="text-xl font-bold text-slate-800">{t('dashboard.title')}</h1>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiTile icon={<PlayCircle size={20} />} value={summary.kpis.runningInstances} label={t('dashboard.kpis.runningInstances')} />
        <KpiTile icon={<ClipboardList size={20} />} value={summary.kpis.myPendingTasks} label={t('dashboard.kpis.myPendingTasks')} />
        <KpiTile icon={<Workflow size={20} />} value={summary.kpis.publishedProcesses} label={t('dashboard.kpis.publishedProcesses')} />
        <KpiTile icon={<Users size={20} />} value={summary.kpis.clients} label={t('dashboard.kpis.clients')} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <StatusBreakdownCard summary={summary} />
        <WeeklyVolumeCard summary={summary} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <MyTasksCard summary={summary} />
        <RecentActivityCard summary={summary} />
      </div>
    </div>
  );
}
