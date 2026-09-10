import { Pool, PoolClient } from 'pg';
import { NotificationType } from '../types';
import {
  sendAccountDeactivatedEmail,
  sendPasswordChangedEmail,
  sendProcessCompletedEmail,
  sendTaskAssignedEmail,
  sendWelcomeEmail,
} from '../lib/mailer';
import { logger } from '../lib/logger';

type Executor = Pool | PoolClient;

export async function createNotification(
  client: Executor,
  params: { userId: string; type: NotificationType; title: string; message: string; link?: string }
): Promise<void> {
  await client.query(
    `INSERT INTO notifications (user_id, type, title, message, link) VALUES ($1, $2, $3, $4, $5)`,
    [params.userId, params.type, params.title, params.message, params.link ?? null]
  );
}

/**
 * Les notifications de flux de travail (tâches, désactivation, fin de
 * processus) respectent la préférence email de l'utilisateur ; les emails de
 * sécurité (bienvenue, mot de passe) sont toujours envoyés.
 */
async function isEmailEnabled(client: Executor, userId: string): Promise<boolean> {
  const { rows } = await client.query<{ email_notifications_enabled: boolean }>(
    'SELECT email_notifications_enabled FROM users WHERE id = $1',
    [userId]
  );
  return rows[0]?.email_notifications_enabled ?? true;
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

  if (await isEmailEnabled(client, recipientId)) {
    sendTaskAssignedEmail({
      to: recipientEmail,
      recipientName,
      taskName,
      processName,
      isDelegated,
      originalAssigneeName,
    }).catch((err) => logger.error('notifyTaskAssigned email failed', { error: (err as Error).message }));
  }
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

  if (await isEmailEnabled(client, params.userId)) {
    sendAccountDeactivatedEmail({
      to: params.email,
      recipientName: params.fullName,
      reassignedCount: params.reassignedCount,
    }).catch((err) => logger.error('notifyAccountDeactivated email failed', { error: (err as Error).message }));
  }
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

  if (await isEmailEnabled(client, params.userId)) {
    sendProcessCompletedEmail({
      to: params.email,
      recipientName: params.fullName,
      processName: params.processName,
      outcome: params.outcome,
    }).catch((err) => logger.error('notifyProcessCompleted email failed', { error: (err as Error).message }));
  }
}

export async function notifyWelcome(
  client: Executor,
  params: { userId: string; email: string; fullName: string; temporaryPassword: string }
): Promise<void> {
  await createNotification(client, {
    userId: params.userId,
    type: 'GENERIC',
    title: 'Bienvenue sur BPM Platform',
    message: 'Votre compte a été créé. Un email contenant vos identifiants vous a été envoyé.',
  });

  sendWelcomeEmail({
    to: params.email,
    recipientName: params.fullName,
    email: params.email,
    temporaryPassword: params.temporaryPassword,
  }).catch((err) => logger.error('notifyWelcome email failed', { error: (err as Error).message }));
}

export async function notifyPasswordChanged(
  client: Executor,
  params: { userId: string; email: string; fullName: string; changedByAdmin: boolean }
): Promise<void> {
  await createNotification(client, {
    userId: params.userId,
    type: 'GENERIC',
    title: 'Mot de passe modifié',
    message: params.changedByAdmin
      ? 'Votre mot de passe a été réinitialisé par un administrateur.'
      : 'Votre mot de passe a été modifié.',
  });

  sendPasswordChangedEmail({
    to: params.email,
    recipientName: params.fullName,
    changedByAdmin: params.changedByAdmin,
  }).catch((err) => logger.error('notifyPasswordChanged email failed', { error: (err as Error).message }));
}
