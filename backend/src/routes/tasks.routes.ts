import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { HttpError } from '../middleware/errorHandler';
import { completeTaskAndAdvance } from '../services/workflowEngine';
import { filterFormDataForUser, writableFieldKeys, getPermissionRows } from '../services/permissionService';
import { ProcessInstanceRow, ProcessRow, TaskRow } from '../types';

export const tasksRouter = Router();
tasksRouter.use(requireAuth);

function canHandle(task: TaskRow, user: { id: string; roleIds: number[] }): boolean {
  if (task.effective_assignee_id) return task.effective_assignee_id === user.id;
  if (task.assignee_role_id) return user.roleIds.includes(task.assignee_role_id);
  return false;
}

tasksRouter.get(
  '/my-tasks',
  asyncHandler(async (req, res) => {
    const isAdmin = req.user!.roles.includes('ADMIN');
    const { rows } = await pool.query<
      TaskRow & {
        process_name: string;
        process_id: string;
        instance_status: string;
        is_pool_task: boolean;
        instance_form_data: Record<string, unknown>;
      }
    >(
      `SELECT t.*, p.name AS process_name, p.id AS process_id, pi.status AS instance_status,
              pi.form_data AS instance_form_data,
              (t.effective_assignee_id IS NULL) AS is_pool_task
       FROM tasks t
       JOIN process_instances pi ON pi.id = t.instance_id
       JOIN processes p ON p.id = pi.process_id
       WHERE t.status = 'PENDING'
         AND (t.effective_assignee_id = $1 OR (t.effective_assignee_id IS NULL AND t.assignee_role_id = ANY($2::int[])))
       ORDER BY t.created_at ASC`,
      [req.user!.id, req.user!.roleIds]
    );

    const tasks = await Promise.all(
      rows.map(async (row) => {
        if (isAdmin) return row;
        const matrixRows = await getPermissionRows(row.process_id, row.step_name, req.user!.roleIds);
        return { ...row, instance_form_data: filterFormDataForUser(row.instance_form_data, matrixRows, isAdmin) };
      })
    );

    res.json({ tasks });
  })
);

const completeTaskSchema = z.object({
  formData: z.record(z.unknown()).default({}),
});

tasksRouter.post(
  '/:id/complete',
  asyncHandler(async (req, res) => {
    const body = completeTaskSchema.parse(req.body);

    const { rows: taskRows } = await pool.query<TaskRow>('SELECT * FROM tasks WHERE id = $1', [req.params.id]);
    const task = taskRows[0];
    if (!task) throw new HttpError(404, 'Tâche introuvable');
    if (task.status !== 'PENDING') throw new HttpError(409, 'Cette tâche a déjà été traitée');
    if (!canHandle(task, req.user!)) throw new HttpError(403, "Cette tâche ne vous est pas assignée");

    for (const field of task.form_schema) {
      if (field.required && (body.formData[field.key] === undefined || body.formData[field.key] === '')) {
        throw new HttpError(400, `Le champ "${field.label}" est obligatoire`);
      }
    }

    const { rows: instRows } = await pool.query<ProcessInstanceRow>(
      'SELECT * FROM process_instances WHERE id = $1',
      [task.instance_id]
    );
    const instance = instRows[0];
    if (!instance) throw new HttpError(404, 'Instance introuvable');

    const { rows: procRows } = await pool.query<ProcessRow>('SELECT * FROM processes WHERE id = $1', [
      instance.process_id,
    ]);
    const process = procRows[0];
    if (!process) throw new HttpError(404, 'Processus introuvable');

    if (!req.user!.roles.includes('ADMIN')) {
      const matrixRows = await getPermissionRows(process.id, task.step_name, req.user!.roleIds);
      const allowedKeys = writableFieldKeys(matrixRows, false);
      if (allowedKeys) {
        for (const key of Object.keys(body.formData)) {
          if (!allowedKeys.has(key)) {
            throw new HttpError(403, `Vous n'avez pas le droit de modifier le champ "${key}" à cette étape`);
          }
        }
      }
    }

    const updatedInstance = await withTransaction((client) =>
      completeTaskAndAdvance(client, {
        task,
        instance,
        process,
        completedById: req.user!.id,
        formData: body.formData,
      })
    );

    res.json({ instance: updatedInstance });
  })
);
