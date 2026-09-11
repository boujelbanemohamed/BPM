import { Pool, PoolClient } from 'pg';
import { HttpError } from '../middleware/errorHandler';
import { ProcessInstanceRow, TaskRow } from '../types';

export interface InstanceAccessUser {
  id: string;
  roleIds: number[];
  roles: string[];
}

/**
 * Charge une instance et ses tâches. Utilisé par tout endpoint qui doit
 * vérifier si l'utilisateur courant est un participant de l'instance
 * (documents, commentaires, détail d'instance).
 */
export async function loadInstanceContext(
  client: Pool | PoolClient,
  instanceId: string
): Promise<{ instance: ProcessInstanceRow; tasks: TaskRow[] }> {
  const { rows: instRows } = await client.query<ProcessInstanceRow>('SELECT * FROM process_instances WHERE id = $1', [
    instanceId,
  ]);
  const instance = instRows[0];
  if (!instance) throw new HttpError(404, 'Instance introuvable');

  const { rows: tasks } = await client.query<TaskRow>('SELECT * FROM tasks WHERE instance_id = $1', [instanceId]);
  return { instance, tasks };
}

/**
 * Un participant est : un administrateur, la personne ayant démarré
 * l'instance, ou toute personne assignée (directement ou via son rôle) à
 * l'une des tâches de l'instance.
 */
export function isInstanceParticipant(
  instance: Pick<ProcessInstanceRow, 'started_by'>,
  tasks: Pick<TaskRow, 'effective_assignee_id' | 'assignee_role_id'>[],
  user: InstanceAccessUser
): boolean {
  if (user.roles.includes('ADMIN')) return true;
  if (instance.started_by === user.id) return true;
  return tasks.some(
    (t) => t.effective_assignee_id === user.id || (t.assignee_role_id && user.roleIds.includes(t.assignee_role_id))
  );
}
