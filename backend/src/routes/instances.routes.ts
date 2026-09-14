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
import { paginationClause, paginationQuerySchema } from '../lib/pagination';
import { toCsv } from '../lib/csv';
import { AuditLogRow, ProcessInstanceRow, ProcessRow, TaskRow } from '../types';

export const instancesRouter = Router();
instancesRouter.use(requireAuth);

const instanceFiltersSchema = z.object({
  status: z.enum(['RUNNING', 'COMPLETED', 'CANCELLED']).optional(),
  processKey: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

/**
 * Construit la clause WHERE (visibilité de l'utilisateur + filtres optionnels)
 * partagée par la liste paginée et l'export CSV, pour ne jamais laisser les
 * deux diverger sur les règles de visibilité.
 */
function buildInstanceFilter(
  user: { id: string; roleIds: number[]; roles: string[] },
  filters: z.infer<typeof instanceFiltersSchema>
): { where: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const isAdmin = user.roles.includes('ADMIN');

  if (!isAdmin) {
    params.push(user.id, user.roleIds);
    conditions.push(`(pi.started_by = $${params.length - 1} OR EXISTS (
      SELECT 1 FROM tasks t WHERE t.instance_id = pi.id
      AND (t.effective_assignee_id = $${params.length - 1} OR t.assignee_role_id = ANY($${params.length}::int[]))
    ))`);
  }
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`pi.status = $${params.length}`);
  }
  if (filters.processKey) {
    params.push(filters.processKey);
    conditions.push(`p.process_key = $${params.length}`);
  }
  if (filters.dateFrom) {
    params.push(filters.dateFrom);
    conditions.push(`pi.started_at >= $${params.length}::date`);
  }
  if (filters.dateTo) {
    params.push(filters.dateTo);
    conditions.push(`pi.started_at < ($${params.length}::date + INTERVAL '1 day')`);
  }

  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

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
    const pagination = paginationQuerySchema.parse(req.query);
    const filters = instanceFiltersSchema.parse(req.query);
    const isAdmin = req.user!.roles.includes('ADMIN');
    const { where, params } = buildInstanceFilter(req.user!, filters);
    const filterParamCount = params.length;

    const { rows } = await pool.query<ProcessInstanceRow & { process_name: string; started_by_name: string }>(
      `SELECT pi.*, p.name AS process_name, u.full_name AS started_by_name
       FROM process_instances pi
       JOIN processes p ON p.id = pi.process_id
       JOIN users u ON u.id = pi.started_by
       ${where}
       ORDER BY pi.started_at DESC
       ${paginationClause(params, pagination)}`,
      params
    );

    const { rows: countRows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text
       FROM process_instances pi
       JOIN processes p ON p.id = pi.process_id
       ${where}`,
      params.slice(0, filterParamCount)
    );
    const total = Number(countRows[0].count);

    const instances = await Promise.all(
      rows.map(async (row) => {
        if (isAdmin || !row.current_step_name) return row;
        const matrixRows = await getPermissionRows(row.process_id, row.current_step_name, req.user!.roleIds);
        return { ...row, form_data: filterFormDataForUser(row.form_data, matrixRows, isAdmin) };
      })
    );

    res.json({ instances, total });
  })
);

// Liste des processus (regroupés par process_key, indépendamment de la version)
// ayant au moins une instance visible par l'utilisateur courant, pour peupler
// le filtre "Processus" de la page Instances sans exiger l'accès à la
// conception des processus (contrairement à /processes/published-minimal).
instancesRouter.get(
  '/filters/processes',
  asyncHandler(async (req, res) => {
    const { where, params } = buildInstanceFilter(req.user!, {});
    const { rows } = await pool.query<{ process_key: string; name: string }>(
      `SELECT DISTINCT p.process_key, p.name
       FROM process_instances pi
       JOIN processes p ON p.id = pi.process_id
       ${where}
       ORDER BY p.name ASC`,
      params
    );
    res.json({ processes: rows });
  })
);

// Plafond de sécurité sur l'export : au-delà, on retourne quand même un CSV
// complet des lignes filtrées jusqu'à cette limite plutôt que de bloquer,
// à affiner en pagination d'export si un déploiement l'atteint un jour.
const INSTANCE_EXPORT_LIMIT = 5000;

instancesRouter.get(
  '/export.csv',
  asyncHandler(async (req, res) => {
    const filters = instanceFiltersSchema.parse(req.query);
    const { where, params } = buildInstanceFilter(req.user!, filters);

    const { rows } = await pool.query<
      ProcessInstanceRow & { process_name: string; started_by_name: string }
    >(
      `SELECT pi.*, p.name AS process_name, u.full_name AS started_by_name
       FROM process_instances pi
       JOIN processes p ON p.id = pi.process_id
       JOIN users u ON u.id = pi.started_by
       ${where}
       ORDER BY pi.started_at DESC
       LIMIT ${INSTANCE_EXPORT_LIMIT}`,
      params
    );

    const csv = toCsv(
      ['Processus', 'Statut', 'Étape actuelle', 'Démarrée par', 'Démarrée le', 'Terminée le'],
      rows.map((r) => [
        r.process_name,
        r.status,
        r.current_step_name ?? '',
        r.started_by_name,
        new Date(r.started_at).toLocaleString('fr-FR'),
        r.completed_at ? new Date(r.completed_at).toLocaleString('fr-FR') : '',
      ])
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="instances_export.csv"');
    res.send(`﻿${csv}`);
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

    let parentInstance: { id: string; process_name: string } | null = null;
    if (instance.parent_instance_id) {
      const { rows: parentRows } = await pool.query<{ id: string; process_name: string }>(
        `SELECT pi.id, p.name AS process_name FROM process_instances pi JOIN processes p ON p.id = pi.process_id WHERE pi.id = $1`,
        [instance.parent_instance_id]
      );
      parentInstance = parentRows[0] ?? null;
    }

    const { rows: childInstances } = await pool.query<{
      id: string;
      process_name: string;
      status: string;
      current_step_name: string | null;
    }>(
      `SELECT pi.id, p.name AS process_name, pi.status, pi.current_step_name
       FROM process_instances pi
       JOIN processes p ON p.id = pi.process_id
       WHERE pi.parent_instance_id = $1
       ORDER BY pi.started_at ASC`,
      [instance.id]
    );

    res.json({
      instance: { ...instance, form_data: visibleFormData },
      tasks,
      events,
      parentInstance,
      childInstances,
    });
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
