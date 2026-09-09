import { Router } from 'express';
import { pool, withTransaction } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { HttpError } from '../middleware/errorHandler';
import { parseGraph, startProcessInstance } from '../services/workflowEngine';
import { filterFormDataForUser, getPermissionRows } from '../services/permissionService';
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
    const isParticipant =
      isAdmin ||
      instance.started_by === req.user!.id ||
      tasks.some((t) => t.effective_assignee_id === req.user!.id || (t.assignee_role_id && req.user!.roleIds.includes(t.assignee_role_id)));
    if (!isParticipant) throw new HttpError(403, "Vous n'avez pas accès à cette instance");

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
          OR (al.entity_type = 'task' AND al.entity_id = ANY($2::uuid[]))
       ORDER BY al.created_at ASC`,
      [instance.id, taskIds]
    );

    res.json({ instance: { ...instance, form_data: visibleFormData }, tasks, events });
  })
);
