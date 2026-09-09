import { PoolClient } from 'pg';
import { NotificationType } from '../types';
import { sendAccountDeactivatedEmail, sendProcessCompletedEmail, sendTaskAssignedEmail } from '../lib/mailer';
import { logger } from '../lib/logger';

export async function createNotification(
  client: PoolClient,
  params: { userId: string; type: NotificationType; title: string; message: string; link?: string }
): Promise<void> {
  await client.query(
    `INSERT INTO notifications (user_id, type, title, message, link) VALUES ($1, $2, $3, $4, $5)`,
    [params.userId, params.type, params.title, params.message, params.link ?? null]
  );
}

export async function notifyTaskAssigned(
  client: PoolClient,
  params: {
    recipientId: string;
    recipientEmail: string;
    recipientName: string;
    taskName: string;
    processName: string;
    isDelegated: boolean;
    originalAssigneeName?: string;
  }
): Promise<void> {
  const { recipientId, recipientEmail, recipientName, taskName, processName, isDelegated, originalAssigneeName } =
    params;

  await createNotification(client, {
    userId: recipientId,
    type: isDelegated ? 'TASK_DELEGATED' : 'TASK_ASSIGNED',
    title: isDelegated ? `Tâche déléguée : ${taskName}` : `Nouvelle tâche : ${taskName}`,
    message: isDelegated
      ? `Vous recevez la tâche "${taskName}" du processus "${processName}" en tant que suppléant de ${originalAssigneeName ?? 'l\'assigné initial'}.`
      : `La tâche "${taskName}" du processus "${processName}" vous a été assignée.`,
    link: '/tasks',
  });

  sendTaskAssignedEmail({
    to: recipientEmail,
    recipientName,
    taskName,
    processName,
    isDelegated,
    originalAssigneeName,
  }).catch((err) => logger.error('notifyTaskAssigned email failed', { error: (err as Error).message }));
}

export async function notifyAccountDeactivated(
  client: PoolClient,
  params: { userId: string; email: string; fullName: string; reassignedCount: number }
): Promise<void> {
  await createNotification(client, {
    userId: params.userId,
    type: 'ACCOUNT_DEACTIVATED',
    title: 'Compte désactivé',
    message: `Votre compte a été désactivé. ${params.reassignedCount} tâche(s) réassignée(s) à votre chaîne de suppléance.`,
  });

  sendAccountDeactivatedEmail({
    to: params.email,
    recipientName: params.fullName,
    reassignedCount: params.reassignedCount,
  }).catch((err) => logger.error('notifyAccountDeactivated email failed', { error: (err as Error).message }));
}

export async function notifyProcessCompleted(
  client: PoolClient,
  params: { userId: string; email: string; fullName: string; processName: string; outcome: string; instanceId: string }
): Promise<void> {
  await createNotification(client, {
    userId: params.userId,
    type: 'PROCESS_COMPLETED',
    title: `Processus terminé : ${params.processName}`,
    message: `Le processus "${params.processName}" que vous avez démarré est terminé (${params.outcome}).`,
    link: `/instances/${params.instanceId}`,
  });

  sendProcessCompletedEmail({
    to: params.email,
    recipientName: params.fullName,
    processName: params.processName,
    outcome: params.outcome,
  }).catch((err) => logger.error('notifyProcessCompleted email failed', { error: (err as Error).message }));
}
