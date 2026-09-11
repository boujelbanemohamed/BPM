import { pool, withTransaction } from '../db/pool';
import { fireDueTimer } from './workflowEngine';
import { logger } from '../lib/logger';

const DEFAULT_POLL_INTERVAL_MS = 15000;

/**
 * Relance chaque minuteur dû (fire_at <= now()) dans sa propre
 * transaction, pour qu'un minuteur en échec (instance/processus
 * introuvable, XML invalide...) n'empêche pas les autres d'être traités.
 */
export async function pollAndFireDueTimers(): Promise<void> {
  const { rows: due } = await pool.query<{ instance_id: string; element_id: string }>(
    `SELECT instance_id, element_id FROM scheduled_timers WHERE fire_at <= now()`
  );

  for (const timer of due) {
    try {
      await withTransaction((client) =>
        fireDueTimer(client, { instanceId: timer.instance_id, elementId: timer.element_id })
      );
    } catch (err) {
      logger.error('Failed to fire scheduled timer', {
        instanceId: timer.instance_id,
        elementId: timer.element_id,
        error: (err as Error).message,
      });
    }
  }
}

let pollerHandle: NodeJS.Timeout | null = null;

/** Démarre le poller interne ; sans effet si déjà démarré (idempotent). */
export function startTimerPoller(intervalMs: number = DEFAULT_POLL_INTERVAL_MS): void {
  if (pollerHandle) return;
  pollerHandle = setInterval(() => {
    pollAndFireDueTimers().catch((err) => logger.error('Timer poller tick failed', { error: (err as Error).message }));
  }, intervalMs);
  logger.info(`Timer poller started (interval: ${intervalMs}ms)`);
}

export function stopTimerPoller(): void {
  if (!pollerHandle) return;
  clearInterval(pollerHandle);
  pollerHandle = null;
}
