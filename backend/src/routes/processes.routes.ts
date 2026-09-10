import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { requirePageAccess } from '../middleware/pageAccess';
import { asyncHandler } from '../middleware/asyncHandler';
import { HttpError } from '../middleware/errorHandler';
import { writeAuditLog, writeAuditLogTx } from '../lib/audit';
import { parseGraph } from '../services/workflowEngine';
import { PermissionMatrixRow, ProcessRow } from '../types';

export const processesRouter = Router();
processesRouter.use(requireAuth);

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

const DEFAULT_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                   xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                   xmlns:bpm="http://bpm-platform.local/schema/1.0"
                   id="Definitions_1" targetNamespace="http://bpm-platform.local/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="StartEvent_1" name="Début" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1">
        <dc:Bounds x="152" y="82" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

processesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query<ProcessRow & { created_by_name: string }>(
      `SELECT p.*, u.full_name AS created_by_name
       FROM processes p JOIN users u ON u.id = p.created_by
       ORDER BY p.name ASC, p.version DESC`
    );
    res.json({ processes: rows });
  })
);

processesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query<ProcessRow>('SELECT * FROM processes WHERE id = $1', [req.params.id]);
    if (rows.length === 0) throw new HttpError(404, 'Processus introuvable');
    res.json({ process: rows[0] });
  })
);

const createProcessSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  bpmnXml: z.string().optional(),
});

processesRouter.post(
  '/',
  requirePageAccess('PROCESSES_DESIGN', 'FULL'),
  asyncHandler(async (req, res) => {
    const body = createProcessSchema.parse(req.body);
    const bpmnXml = body.bpmnXml ?? DEFAULT_BPMN;
    parseGraph(bpmnXml); // valide la structure avant sauvegarde

    try {
      const { rows } = await pool.query<ProcessRow>(
        `INSERT INTO processes (process_key, name, description, bpmn_xml, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [slugify(body.name), body.name, body.description ?? null, bpmnXml, req.user!.id]
      );

      await writeAuditLog({
        userId: req.user!.id,
        action: 'PROCESS_CREATED',
        entityType: 'process',
        entityId: rows[0].id,
        details: { name: body.name },
        ipAddress: req.ip,
      });

      res.status(201).json({ process: rows[0] });
    } catch (err: any) {
      if (err.code === '23505') throw new HttpError(409, 'Un processus avec ce nom existe déjà');
      throw err;
    }
  })
);

const updateProcessSchema = z.object({
  name: z.string().min(2).optional(),
  description: z.string().optional(),
  bpmnXml: z.string().optional(),
});

processesRouter.put(
  '/:id',
  requirePageAccess('PROCESSES_DESIGN', 'FULL'),
  asyncHandler(async (req, res) => {
    const body = updateProcessSchema.parse(req.body);
    const { rows: existingRows } = await pool.query<ProcessRow>('SELECT * FROM processes WHERE id = $1', [
      req.params.id,
    ]);
    const existing = existingRows[0];
    if (!existing) throw new HttpError(404, 'Processus introuvable');
    if (existing.status !== 'DRAFT') throw new HttpError(409, 'Seul un processus en brouillon peut être modifié');

    if (body.bpmnXml) parseGraph(body.bpmnXml);

    const { rows } = await pool.query<ProcessRow>(
      `UPDATE processes SET name = $1, description = $2, bpmn_xml = $3, process_key = $4
       WHERE id = $5 RETURNING *`,
      [
        body.name ?? existing.name,
        body.description ?? existing.description,
        body.bpmnXml ?? existing.bpmn_xml,
        body.name ? slugify(body.name) : existing.process_key,
        existing.id,
      ]
    );

    await writeAuditLog({
      userId: req.user!.id,
      action: 'PROCESS_UPDATED',
      entityType: 'process',
      entityId: existing.id,
      ipAddress: req.ip,
    });

    res.json({ process: rows[0] });
  })
);

processesRouter.post(
  '/:id/publish',
  requirePageAccess('PROCESSES_DESIGN', 'FULL'),
  asyncHandler(async (req, res) => {
    const { rows: existingRows } = await pool.query<ProcessRow>('SELECT * FROM processes WHERE id = $1', [
      req.params.id,
    ]);
    const existing = existingRows[0];
    if (!existing) throw new HttpError(404, 'Processus introuvable');
    if (existing.status !== 'DRAFT') throw new HttpError(409, 'Ce processus est déjà publié');

    const graph = parseGraph(existing.bpmn_xml);
    if (!graph.nodes.some((n) => n.type === 'endEvent')) {
      throw new HttpError(400, 'Le processus doit contenir au moins un événement de fin avant publication');
    }

    const { rows } = await pool.query<ProcessRow>(
      `UPDATE processes SET status = 'PUBLISHED' WHERE id = $1 RETURNING *`,
      [existing.id]
    );

    await writeAuditLog({
      userId: req.user!.id,
      action: 'PROCESS_PUBLISHED',
      entityType: 'process',
      entityId: existing.id,
      ipAddress: req.ip,
    });

    res.json({ process: rows[0] });
  })
);

// ---------------------------------------------------------------------
// Matrice de visibilité / droits par processus + étape + rôle
// ---------------------------------------------------------------------

processesRouter.get(
  '/:id/permissions',
  requirePageAccess('PERMISSIONS_MATRIX', 'VIEW'),
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query<PermissionMatrixRow>(
      'SELECT * FROM permissions_matrix WHERE process_id = $1 ORDER BY step_name ASC',
      [req.params.id]
    );
    res.json({ permissions: rows });
  })
);

const permissionRowSchema = z.object({
  stepName: z.string().min(1),
  roleId: z.number().int(),
  fieldPermissions: z.record(z.object({ read: z.boolean(), write: z.boolean() })),
  canViewDocuments: z.boolean(),
  canUploadDocuments: z.boolean(),
});

const putPermissionsSchema = z.object({ rows: z.array(permissionRowSchema) });

processesRouter.put(
  '/:id/permissions',
  requirePageAccess('PERMISSIONS_MATRIX', 'FULL'),
  asyncHandler(async (req, res) => {
    const body = putPermissionsSchema.parse(req.body);
    const processId = req.params.id;

    await withTransaction(async (client) => {
      const { rows: procRows } = await client.query('SELECT id FROM processes WHERE id = $1', [processId]);
      if (procRows.length === 0) throw new HttpError(404, 'Processus introuvable');

      await client.query('DELETE FROM permissions_matrix WHERE process_id = $1', [processId]);
      for (const row of body.rows) {
        await client.query(
          `INSERT INTO permissions_matrix (process_id, step_name, role_id, field_permissions, can_view_documents, can_upload_documents)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            processId,
            row.stepName,
            row.roleId,
            JSON.stringify(row.fieldPermissions),
            row.canViewDocuments,
            row.canUploadDocuments,
          ]
        );
      }

      await writeAuditLogTx(client, {
        userId: req.user!.id,
        action: 'PERMISSIONS_UPDATED',
        entityType: 'process',
        entityId: processId,
        details: { rowCount: body.rows.length },
        ipAddress: req.ip,
      });
    });

    const { rows } = await pool.query<PermissionMatrixRow>(
      'SELECT * FROM permissions_matrix WHERE process_id = $1 ORDER BY step_name ASC',
      [processId]
    );
    res.json({ permissions: rows });
  })
);
