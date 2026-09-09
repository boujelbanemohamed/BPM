import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import { pool } from '../db/pool';
import { env } from '../config/env';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { HttpError } from '../middleware/errorHandler';
import { writeAuditLog } from '../lib/audit';
import { canUploadDocuments, canViewDocuments } from '../services/permissionService';
import { DocumentRow, ProcessInstanceRow, TaskRow } from '../types';

export const documentsRouter = Router();
documentsRouter.use(requireAuth);

fs.mkdirSync(env.UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
]);

const upload = multer({
  storage: multer.diskStorage({
    destination: env.UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).slice(0, 10);
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new HttpError(400, `Type de fichier non autorisé : ${file.mimetype}`) as unknown as Error);
      return;
    }
    cb(null, true);
  },
});

async function loadInstanceContext(instanceId: string) {
  const { rows: instRows } = await pool.query<ProcessInstanceRow>('SELECT * FROM process_instances WHERE id = $1', [
    instanceId,
  ]);
  const instance = instRows[0];
  if (!instance) throw new HttpError(404, 'Instance introuvable');

  const { rows: tasks } = await pool.query<TaskRow>('SELECT * FROM tasks WHERE instance_id = $1', [instanceId]);
  return { instance, tasks };
}

function isInstanceParticipant(
  instance: ProcessInstanceRow,
  tasks: TaskRow[],
  user: { id: string; roleIds: number[]; roles: string[] }
): boolean {
  if (user.roles.includes('ADMIN')) return true;
  if (instance.started_by === user.id) return true;
  return tasks.some(
    (t) => t.effective_assignee_id === user.id || (t.assignee_role_id && user.roleIds.includes(t.assignee_role_id))
  );
}

documentsRouter.post(
  '/instances/:instanceId/documents',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const { instance, tasks } = await loadInstanceContext(req.params.instanceId);
    if (!isInstanceParticipant(instance, tasks, req.user!)) {
      throw new HttpError(403, "Vous n'avez pas accès à cette instance");
    }

    const isAdmin = req.user!.roles.includes('ADMIN');
    if (instance.current_step_name) {
      const allowed = await canUploadDocuments(instance.process_id, instance.current_step_name, req.user!.roleIds, isAdmin);
      if (!allowed) throw new HttpError(403, "Vous n'avez pas le droit de déposer un document à cette étape");
    }

    if (!req.file) throw new HttpError(400, 'Aucun fichier fourni (champ "file" attendu)');

    const taskId = typeof req.body?.taskId === 'string' && req.body.taskId ? req.body.taskId : null;

    const { rows } = await pool.query<DocumentRow>(
      `INSERT INTO documents (instance_id, task_id, filename, mime_type, size_bytes, storage_path, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [instance.id, taskId, req.file.originalname, req.file.mimetype, req.file.size, req.file.filename, req.user!.id]
    );

    await writeAuditLog({
      userId: req.user!.id,
      action: 'DOCUMENT_UPLOADED',
      entityType: 'document',
      entityId: rows[0].id,
      details: { instanceId: instance.id, filename: req.file.originalname },
      ipAddress: req.ip,
    });

    res.status(201).json({ document: rows[0] });
  })
);

documentsRouter.get(
  '/instances/:instanceId/documents',
  asyncHandler(async (req, res) => {
    const { instance, tasks } = await loadInstanceContext(req.params.instanceId);
    if (!isInstanceParticipant(instance, tasks, req.user!)) {
      throw new HttpError(403, "Vous n'avez pas accès à cette instance");
    }

    const isAdmin = req.user!.roles.includes('ADMIN');
    if (instance.current_step_name) {
      const allowed = await canViewDocuments(instance.process_id, instance.current_step_name, req.user!.roleIds, isAdmin);
      if (!allowed) throw new HttpError(403, "Vous n'avez pas accès aux documents de cette étape");
    }

    const { rows } = await pool.query<DocumentRow & { uploaded_by_name: string }>(
      `SELECT d.*, u.full_name AS uploaded_by_name FROM documents d
       JOIN users u ON u.id = d.uploaded_by
       WHERE d.instance_id = $1 ORDER BY d.uploaded_at DESC`,
      [instance.id]
    );
    res.json({ documents: rows });
  })
);

documentsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query<DocumentRow>('SELECT * FROM documents WHERE id = $1', [req.params.id]);
    const document = rows[0];
    if (!document) throw new HttpError(404, 'Document introuvable');

    const { instance, tasks } = await loadInstanceContext(document.instance_id);
    const isAdmin = req.user!.roles.includes('ADMIN');
    const isUploader = document.uploaded_by === req.user!.id;

    if (!isUploader && !isInstanceParticipant(instance, tasks, req.user!)) {
      throw new HttpError(403, "Vous n'avez pas accès à ce document");
    }
    if (!isUploader && !isAdmin && instance.current_step_name) {
      const allowed = await canViewDocuments(instance.process_id, instance.current_step_name, req.user!.roleIds, isAdmin);
      if (!allowed) throw new HttpError(403, "Vous n'avez pas accès aux documents de cette étape");
    }

    const absolutePath = path.join(env.UPLOAD_DIR, path.basename(document.storage_path));
    if (!fs.existsSync(absolutePath)) throw new HttpError(404, 'Fichier introuvable sur le serveur');

    await writeAuditLog({
      userId: req.user!.id,
      action: 'DOCUMENT_DOWNLOADED',
      entityType: 'document',
      entityId: document.id,
      details: { filename: document.filename },
      ipAddress: req.ip,
    });

    res.download(absolutePath, document.filename);
  })
);
