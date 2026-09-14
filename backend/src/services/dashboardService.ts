import { Pool, PoolClient } from 'pg';
import { AuthenticatedUser, InstanceStatus } from '../types';

const RECENT_ACTIVITY_LIMIT = 10;
const MY_TASKS_PREVIEW_LIMIT = 5;
const WEEKS = 8;

export interface DashboardKpis {
  runningInstances: number;
  myPendingTasks: number;
  publishedProcesses: number;
  clients: number;
}

export interface StatusBreakdownEntry {
  status: InstanceStatus;
  count: number;
}

export interface WeeklyVolumePoint {
  weekStart: string;
  count: number;
}

export interface DashboardTaskPreview {
  id: string;
  stepName: string;
  processName: string;
  instanceId: string;
  createdAt: string;
}

export interface DashboardActivityItem {
  instanceId: string;
  processName: string;
  event: 'STARTED' | 'COMPLETED' | 'CANCELLED';
  at: string;
  actorName: string | null;
}

export interface DashboardSummary {
  kpis: DashboardKpis;
  statusBreakdown: StatusBreakdownEntry[];
  weeklyVolume: WeeklyVolumePoint[];
  myTasks: DashboardTaskPreview[];
  recentActivity: DashboardActivityItem[];
}

const ALL_STATUSES: InstanceStatus[] = ['RUNNING', 'COMPLETED', 'CANCELLED'];

/**
 * Fragment de visibilité des instances, identique à celui de GET /instances
 * (admin = tout ; sinon uniquement les instances démarrées par l'utilisateur
 * ou comportant une tâche qui lui est assignée, directement ou via son
 * rôle) — pousse ses propres paramètres à la fin de `params` et renvoie le
 * fragment "AND (...)" à insérer après les conditions déjà posées par
 * l'appelant, pour que la numérotation $N reste correcte quel que soit le
 * nombre de paramètres déjà présents.
 */
function instanceVisibilityClause(params: unknown[], user: Pick<AuthenticatedUser, 'id' | 'roles' | 'roleIds'>): string {
  if (user.roles.includes('ADMIN')) return '';
  params.push(user.id, user.roleIds);
  const userIdx = params.length - 1;
  const roleIdx = params.length;
  return `AND (pi.started_by = $${userIdx} OR EXISTS (
    SELECT 1 FROM tasks t WHERE t.instance_id = pi.id
    AND (t.effective_assignee_id = $${userIdx} OR t.assignee_role_id = ANY($${roleIdx}::int[]))
  ))`;
}

/** Lundis (00:00 UTC) des `n` dernières semaines écoulées, la plus ancienne en premier — sert à combler de zéros les semaines sans instance démarrée. */
function lastNWeekStarts(n: number): string[] {
  const now = new Date();
  const day = now.getUTCDay();
  const diffToMonday = (day + 6) % 7;
  const thisMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diffToMonday));
  const weeks: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(thisMonday);
    d.setUTCDate(d.getUTCDate() - i * 7);
    weeks.push(d.toISOString().slice(0, 10));
  }
  return weeks;
}

export async function getDashboardSummary(
  client: Pool | PoolClient,
  user: Pick<AuthenticatedUser, 'id' | 'roles' | 'roleIds'>
): Promise<DashboardSummary> {
  const statusParams: unknown[] = [];
  const statusVisibility = instanceVisibilityClause(statusParams, user);
  const { rows: statusRows } = await client.query<{ status: InstanceStatus; count: string }>(
    `SELECT pi.status, COUNT(*)::text AS count
     FROM process_instances pi
     WHERE TRUE ${statusVisibility}
     GROUP BY pi.status`,
    statusParams
  );
  const statusCounts = new Map(statusRows.map((r) => [r.status, Number(r.count)]));
  const statusBreakdown: StatusBreakdownEntry[] = ALL_STATUSES.map((status) => ({
    status,
    count: statusCounts.get(status) ?? 0,
  }));
  const runningInstances = statusCounts.get('RUNNING') ?? 0;

  const { rows: myPendingRows } = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM tasks t
     WHERE t.status = 'PENDING'
       AND (t.effective_assignee_id = $1 OR (t.effective_assignee_id IS NULL AND t.assignee_role_id = ANY($2::int[])))`,
    [user.id, user.roleIds]
  );
  const myPendingTasks = Number(myPendingRows[0].count);

  const { rows: processRows } = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM processes WHERE status = 'PUBLISHED' AND deleted_at IS NULL`
  );
  const publishedProcesses = Number(processRows[0].count);

  const { rows: clientRows } = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM clients`);
  const clientsCount = Number(clientRows[0].count);

  const weeklyParams: unknown[] = [WEEKS];
  const weeklyVisibility = instanceVisibilityClause(weeklyParams, user);
  const { rows: weeklyRows } = await client.query<{ week_start: string; count: string }>(
    `SELECT date_trunc('week', pi.started_at)::date::text AS week_start, COUNT(*)::text AS count
     FROM process_instances pi
     WHERE pi.started_at >= now() - make_interval(weeks => $1::int) ${weeklyVisibility}
     GROUP BY week_start
     ORDER BY week_start ASC`,
    weeklyParams
  );
  const weeklyCounts = new Map(weeklyRows.map((r) => [r.week_start, Number(r.count)]));
  const weeklyVolume: WeeklyVolumePoint[] = lastNWeekStarts(WEEKS).map((weekStart) => ({
    weekStart,
    count: weeklyCounts.get(weekStart) ?? 0,
  }));

  const { rows: myTaskRows } = await client.query<{
    id: string;
    step_name: string;
    process_name: string;
    instance_id: string;
    created_at: string;
  }>(
    `SELECT t.id, t.step_name, p.name AS process_name, t.instance_id, t.created_at
     FROM tasks t
     JOIN process_instances pi ON pi.id = t.instance_id
     JOIN processes p ON p.id = pi.process_id
     WHERE t.status = 'PENDING'
       AND (t.effective_assignee_id = $1 OR (t.effective_assignee_id IS NULL AND t.assignee_role_id = ANY($2::int[])))
     ORDER BY t.created_at ASC
     LIMIT $3`,
    [user.id, user.roleIds, MY_TASKS_PREVIEW_LIMIT]
  );
  const myTasks: DashboardTaskPreview[] = myTaskRows.map((r) => ({
    id: r.id,
    stepName: r.step_name,
    processName: r.process_name,
    instanceId: r.instance_id,
    createdAt: r.created_at,
  }));

  const startedParams: unknown[] = [];
  const startedVisibility = instanceVisibilityClause(startedParams, user);
  const { rows: startedRows } = await client.query<{
    instance_id: string;
    process_name: string;
    at: string;
    actor_name: string | null;
  }>(
    `SELECT pi.id AS instance_id, p.name AS process_name, pi.started_at AS at, u.full_name AS actor_name
     FROM process_instances pi
     JOIN processes p ON p.id = pi.process_id
     JOIN users u ON u.id = pi.started_by
     WHERE TRUE ${startedVisibility}
     ORDER BY pi.started_at DESC
     LIMIT ${RECENT_ACTIVITY_LIMIT}`,
    startedParams
  );

  const finishedParams: unknown[] = [];
  const finishedVisibility = instanceVisibilityClause(finishedParams, user);
  const { rows: finishedRows } = await client.query<{
    instance_id: string;
    process_name: string;
    status: InstanceStatus;
    at: string;
    actor_name: string | null;
  }>(
    `SELECT pi.id AS instance_id, p.name AS process_name, pi.status, pi.completed_at AS at, u.full_name AS actor_name
     FROM process_instances pi
     JOIN processes p ON p.id = pi.process_id
     JOIN users u ON u.id = pi.started_by
     WHERE pi.completed_at IS NOT NULL ${finishedVisibility}
     ORDER BY pi.completed_at DESC
     LIMIT ${RECENT_ACTIVITY_LIMIT}`,
    finishedParams
  );

  const recentActivity: DashboardActivityItem[] = [
    ...startedRows.map(
      (r): DashboardActivityItem => ({
        instanceId: r.instance_id,
        processName: r.process_name,
        event: 'STARTED',
        at: r.at,
        actorName: r.actor_name,
      })
    ),
    ...finishedRows.map(
      (r): DashboardActivityItem => ({
        instanceId: r.instance_id,
        processName: r.process_name,
        event: r.status === 'CANCELLED' ? 'CANCELLED' : 'COMPLETED',
        at: r.at,
        actorName: r.actor_name,
      })
    ),
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, RECENT_ACTIVITY_LIMIT);

  return {
    kpis: { runningInstances, myPendingTasks, publishedProcesses, clients: clientsCount },
    statusBreakdown,
    weeklyVolume,
    myTasks,
    recentActivity,
  };
}
