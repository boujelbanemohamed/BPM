import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { HttpError } from '../middleware/errorHandler';
import { parseGraph, startProcessInstance } from '../services/workflowEngine';
import { filterFormDataForUser, getPermissionRows } from '../services/permissionService';
import { isInstanceParticipant, loadInstanceContext } from '../services/instanceAccess';
import { addComment, listComments } from '../services/commentService';
import { notifyNewComment } from '../services/notificationService';
import { writeAuditLog } from '../lib/audit';
import { AuditLogRow, ProcessInstanceRow, ProcessRow, TaskRow } from '../types';

export const instancesRouter = Router();
instancesRouter.use(requireAuth);

instancesRouter.post(
  '/processes/:processId/start',
  asyncHandler(async (req, res) => {
    const { rows: procRows } = await pool.query<ProcessRow>('SELECT * FROM processes WHERE id = $1', [
      req.params.processId,
    ]);
    const process = procRows[0];
    if (!process) throw new HttpError(404, 'Processus introuvable');
    if (process.status !== 'PUBLISHED') throw new HttpError(409, 'Seul un processus publié peut être démarré');

    const formData = req.body?.formData ?? {};
    const graph = parseGraph(process.bpmn_xml);
    const startNode = graph.nodes.find((n) => n.type === 'startEvent');
    for (const field of startNode?.formFields ?? []) {
      if (field.required && (formData[field.key] === undefined || formData[field.key] === '')) {
        throw new HttpError(400, `Le champ "${field.label}" est obligatoire`);
      }
    }

    const instance = await withTransaction((client) =>
      startProcessInstance(client, {
        process,
        startedById: req.user!.id,
        initialFormData: formData,
      })
    );

    res.status(201).json({ instance });
  })
);

instancesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const isAdmin = req.user!.roles.includes('ADMIN');
    const params: unknown[] = [];
    let where = '';
    if (!isAdmin) {
      where = `WHERE pi.started_by = $1 OR EXISTS (
        SELECT 1 FROM tasks t WHERE t.instance_id = pi.id
        AND (t.effective_assignee_id = $1 OR t.assignee_role_id = ANY($2::int[]))
      )`;
      params.push(req.user!.id, req.user!.roleIds);
    }

    const { rows } = await pool.query<ProcessInstanceRow & { process_name: string; started_by_name: string }>(
      `SELECT pi.*, p.name AS process_name, u.full_name AS started_by_name
       FROM process_instances pi
       JOIN processes p ON p.id = pi.process_id
       JOIN users u ON u.id = pi.started_by
       ${where}
       ORDER BY pi.started_at DESC`,
      params
    );

    const instances = await Promise.all(
      rows.map(async (row) => {
        if (isAdmin || !row.current_step_name) return row;
        const matrixRows = await getPermissionRows(row.process_id, row.current_step_name, req.user!.roleIds);
        return { ...row, form_data: filterFormDataForUser(row.form_data, matrixRows, isAdmin) };
      })
    );

    res.json({ instances });
  })
);

instancesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { rows: instRows } = await pool.query<ProcessInstanceRow & { process_name: string; started_by_name: string }>(
      `SELECT pi.*, p.name AS process_name, u.full_name AS started_by_name
       FROM process_instances pi
       JOIN processes p ON p.id = pi.process_id
       JOIN users u ON u.id = pi.started_by
       WHERE pi.id = $1`,
      [req.params.id]
    );
    const instance = instRows[0];
    if (!instance) throw new HttpError(404, 'Instance introuvable');

    const { rows: tasks } = await pool.query<
      TaskRow & { effective_assignee_name: string | null; completed_by_name: string | null; role_name: string | null }
    >(
      `SELECT t.*, ea.full_name AS effective_assignee_name, cb.full_name AS completed_by_name, r.name AS role_name
       FROM tasks t
       LEFT JOIN users ea ON ea.id = t.effective_assignee_id
       LEFT JOIN users cb ON cb.id = t.completed_by
       LEFT JOIN roles r ON r.id = t.assignee_role_id
       WHERE t.instance_id = $1
       ORDER BY t.created_at ASC`,
      [req.params.id]
    );

    const isAdmin = req.user!.roles.includes('ADMIN');
    if (!isInstanceParticipant(instance, tasks, req.user!)) throw new HttpError(403, "Vous n'avez pas accès à cette instance");

    let visibleFormData = instance.form_data;
    if (!isAdmin && instance.current_step_name) {
      const matrixRows = await getPermissionRows(instance.process_id, instance.current_step_name, req.user!.roleIds);
      visibleFormData = filterFormDataForUser(instance.form_data, matrixRows, isAdmin);
    }

    const taskIds = tasks.map((t) => t.id);
    const { rows: events } = await pool.query<AuditLogRow & { actor_name: string | null }>(
      `SELECT al.*, u.full_name AS actor_name
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
       WHERE (al.entity_type = 'process_instance' AND al.entity_id = $1)
          OR (al.entity_type = 'task' AND al.entity_id = ANY($2::text[]))
       ORDER BY al.created_at ASC`,
      [instance.id, taskIds]
    );

    res.json({ instance: { ...instance, form_data: visibleFormData }, tasks, events });
  })
);

const addCommentSchema = z.object({
  body: z.string().trim().min(1, 'Le commentaire ne peut pas être vide').max(4000),
  taskId: z.string().uuid().optional(),
});

instancesRouter.get(
  '/:id/comments',
  asyncHandler(async (req, res) => {
    const { instance, tasks } = await loadInstanceContext(pool, req.params.id);
    if (!isInstanceParticipant(instance, tasks, req.user!)) throw new HttpError(403, "Vous n'avez pas accès à cette instance");

    const comments = await listComments(pool, instance.id);
    res.json({ comments });
  })
);

instancesRouter.post(
  '/:id/comments',
  asyncHandler(async (req, res) => {
    const { body, taskId } = addCommentSchema.parse(req.body);
    const { instance, tasks } = await loadInstanceContext(pool, req.params.id);
    if (!isInstanceParticipant(instance, tasks, req.user!)) throw new HttpError(403, "Vous n'avez pas accès à cette instance");

    if (taskId && !tasks.some((t) => t.id === taskId)) {
      throw new HttpError(400, "Cette tâche n'appartient pas à cette instance");
    }

    const comment = await addComment(pool, {
      instanceId: instance.id,
      taskId: taskId ?? null,
      authorId: req.user!.id,
      body,
    });

    await writeAuditLog({
      userId: req.user!.id,
      action: 'COMMENT_ADDED',
      entityType: 'process_instance',
      entityId: instance.id,
      details: { commentId: comment.id, taskId: comment.task_id },
      ipAddress: req.ip,
    });

    const { rows: procRows } = await pool.query<{ name: string }>('SELECT name FROM processes WHERE id = $1', [
      instance.process_id,
    ]);
    const processName = procRows[0]?.name ?? 'Processus';

    const recipientIds = new Set<string>();
    if (instance.started_by !== req.user!.id) recipientIds.add(instance.started_by);
    for (const t of tasks) {
      if (t.effective_assignee_id && t.effective_assignee_id !== req.user!.id) recipientIds.add(t.effective_assignee_id);
    }

    await withTransaction(async (client) => {
      for (const recipientId of recipientIds) {
        await notifyNewComment(client, {
          userId: recipientId,
          authorName: req.user!.fullName,
          processName,
          instanceId: instance.id,
        });
      }
    });

    const taskStepName = taskId ? tasks.find((t) => t.id === taskId)?.step_name ?? null : null;
    res.status(201).json({ comment: { ...comment, author_name: req.user!.fullName, task_step_name: taskStepName } });
  })
);
