import { PoolClient } from 'pg';
import { AuthenticatedUser } from '../types';
import { Executor, findUserById } from '../db/usersRepo';
import { HttpError } from '../middleware/errorHandler';

export interface ResolvedAssignee {
  userId: string;
  isDelegated: boolean;
  chain: string[];
}

/**
 * Un utilisateur est disponible s'il est actif ET pas actuellement en congé
 * (période [absence_start, absence_end] incluant aujourd'hui).
 */
export function isUserAvailable(user: AuthenticatedUser): boolean {
  if (!user.isActive) return false;
  if (user.absenceStart && user.absenceEnd) {
    const today = new Date().toISOString().slice(0, 10);
    if (today >= user.absenceStart && today <= user.absenceEnd) return false;
  }
  return true;
}

/**
 * Algorithme de résolution de l'assigné effectif d'une tâche (suppléance à
 * 2 niveaux) :
 *  1. Si le titulaire (candidateUserId) est actif et pas en congé -> lui.
 *  2. Sinon, si Suppléant 1 est actif et pas en congé -> Suppléant 1.
 *  3. Sinon, si Suppléant 2 est actif et pas en congé -> Suppléant 2.
 *  4. Sinon (toute la chaîne indisponible) -> le titulaire reste l'assigné
 *     nominal ; la tâche reste néanmoins traitable par tout titulaire actif
 *     du rôle requis (assignee_role_id), qui sert de filet de sécurité.
 */
export async function resolveEffectiveAssignee(
  executor: Executor,
  candidateUserId: string
): Promise<ResolvedAssignee> {
  const original = await findUserById(executor, candidateUserId);
  if (!original) {
    throw new HttpError(400, `Utilisateur assigné introuvable : ${candidateUserId}`);
  }

  const chain = [original.id];
  if (isUserAvailable(original)) {
    return { userId: original.id, isDelegated: false, chain };
  }

  if (original.delegateUser1Id) {
    const substitute1 = await findUserById(executor, original.delegateUser1Id);
    if (substitute1) {
      chain.push(substitute1.id);
      if (isUserAvailable(substitute1)) {
        return { userId: substitute1.id, isDelegated: true, chain };
      }
    }
  }

  if (original.delegateUser2Id) {
    const substitute2 = await findUserById(executor, original.delegateUser2Id);
    if (substitute2) {
      chain.push(substitute2.id);
      if (isUserAvailable(substitute2)) {
        return { userId: substitute2.id, isDelegated: true, chain };
      }
    }
  }

  return { userId: original.id, isDelegated: false, chain };
}

interface PendingTaskForReassignment {
  id: string;
  original_assignee_id: string | null;
  step_name: string;
  instance_id: string;
}

/**
 * Réassigne instantanément toutes les tâches PENDING dont l'assigné effectif
 * ou original est `userId` vers la chaîne de suppléance résolue à partir de
 * leur assigné original. Appelée lors de la désactivation d'un compte.
 * Retourne le détail des réassignations pour notification.
 */
export async function reassignPendingTasksForUser(
  client: PoolClient,
  userId: string
): Promise<Array<{ taskId: string; instanceId: string; newAssigneeId: string; isDelegated: boolean }>> {
  const { rows } = await client.query<PendingTaskForReassignment>(
    `SELECT id, original_assignee_id, step_name, instance_id
     FROM tasks
     WHERE status = 'PENDING' AND (effective_assignee_id = $1 OR original_assignee_id = $1)`,
    [userId]
  );

  const results: Array<{ taskId: string; instanceId: string; newAssigneeId: string; isDelegated: boolean }> = [];

  for (const task of rows) {
    const anchorUserId = task.original_assignee_id ?? userId;
    const resolved = await resolveEffectiveAssignee(client, anchorUserId);
    await client.query(
      `UPDATE tasks SET effective_assignee_id = $1, is_delegated = $2 WHERE id = $3`,
      [resolved.userId, resolved.isDelegated, task.id]
    );
    results.push({
      taskId: task.id,
      instanceId: task.instance_id,
      newAssigneeId: resolved.userId,
      isDelegated: resolved.isDelegated,
    });
  }

  return results;
}
