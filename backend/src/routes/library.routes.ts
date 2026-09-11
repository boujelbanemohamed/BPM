import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import { z } from 'zod';
import { pool } from '../db/pool';
import { env } from '../config/env';
import { requireAuth } from '../middleware/auth';
import { requirePageAccess } from '../middleware/pageAccess';
import { asyncHandler } from '../middleware/asyncHandler';
import { HttpError } from '../middleware/errorHandler';
import { writeAuditLog } from '../lib/audit';
import { DocumentFolderRow, LibraryDocumentRow } from '../types';

export const libraryRouter = Router();
libraryRouter.use(requireAuth);

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

const createFolderSchema = z.object({ name: z.string().trim().min(1, 'Le nom du dossier est requis').max(255) });

libraryRouter.get(
  '/folders',
  requirePageAccess('DOCUMENTS', 'VIEW'),
  asyncHandler(async (_req, res) => {
    const { rows } = await pool.query<DocumentFolderRow & { created_by_name: string; document_count: number }>(
      `SELECT f.*, u.full_name AS created_by_name,
              (SELECT COUNT(*) FROM library_documents d WHERE d.folder_id = f.id)::int AS document_count
       FROM document_folders f
       JOIN users u ON u.id = f.created_by
       ORDER BY f.name ASC`
    );
    res.json({ folders: rows });
  })
);

libraryRouter.post(
  '/folders',
  requirePageAccess('DOCUMENTS', 'FULL'),
  asyncHandler(async (req, res) => {
    const body = createFolderSchema.parse(req.body);

    const { rows } = await pool.query<DocumentFolderRow>(
      `INSERT INTO document_folders (name, created_by) VALUES ($1, $2) RETURNING *`,
      [body.name, req.user!.id]
    );

    await writeAuditLog({
      userId: req.user!.id,
      action: 'FOLDER_CREATED',
      entityType: 'document_folder',
      entityId: rows[0].id,
      details: { name: body.name },
      ipAddress: req.ip,
    });

    res.status(201).json({ folder: rows[0] });
  })
);

libraryRouter.get(
  '/documents',
  requirePageAccess('DOCUMENTS', 'VIEW'),
  asyncHandler(async (_req, res) => {
    const { rows } = await pool.query<LibraryDocumentRow & { folder_name: string }>(
      `SELECT d.*, f.name AS folder_name
       FROM library_documents d
       JOIN document_folders f ON f.id = d.folder_id
       ORDER BY f.name ASC, d.filename ASC`
    );
    res.json({ documents: rows });
  })
);

libraryRouter.get(
  '/folders/:id',
  requirePageAccess('DOCUMENTS', 'VIEW'),
  asyncHandler(async (req, res) => {
    const { rows: folderRows } = await pool.query<DocumentFolderRow & { created_by_name: string }>(
      `SELECT f.*, u.full_name AS created_by_name FROM document_folders f
       JOIN users u ON u.id = f.created_by WHERE f.id = $1`,
      [req.params.id]
    );
    const folder = folderRows[0];
    if (!folder) throw new HttpError(404, 'Dossier introuvable');

    const { rows: documents } = await pool.query<LibraryDocumentRow & { uploaded_by_name: string }>(
      `SELECT d.*, u.full_name AS uploaded_by_name FROM library_documents d
       JOIN users u ON u.id = d.uploaded_by
       WHERE d.folder_id = $1 ORDER BY d.uploaded_at DESC`,
      [folder.id]
    );

    res.json({ folder, documents });
  })
);

libraryRouter.post(
  '/folders/:id/documents',
  requirePageAccess('DOCUMENTS', 'FULL'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const { rows: folderRows } = await pool.query<DocumentFolderRow>('SELECT * FROM document_folders WHERE id = $1', [
      req.params.id,
    ]);
    const folder = folderRows[0];
    if (!folder) throw new HttpError(404, 'Dossier introuvable');
    if (!req.file) throw new HttpError(400, 'Aucun fichier fourni (champ "file" attendu)');

    const { rows } = await pool.query<LibraryDocumentRow>(
      `INSERT INTO library_documents (folder_id, filename, mime_type, size_bytes, storage_path, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [folder.id, req.file.originalname, req.file.mimetype, req.file.size, req.file.filename, req.user!.id]
    );

    await writeAuditLog({
      userId: req.user!.id,
      action: 'DOCUMENT_UPLOADED',
      entityType: 'library_document',
      entityId: rows[0].id,
      details: { folderId: folder.id, filename: req.file.originalname },
      ipAddress: req.ip,
    });

    res.status(201).json({ document: rows[0] });
  })
);

libraryRouter.get(
  '/documents/:id',
  requirePageAccess('DOCUMENTS', 'VIEW'),
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query<LibraryDocumentRow>('SELECT * FROM library_documents WHERE id = $1', [
      req.params.id,
    ]);
    const document = rows[0];
    if (!document) throw new HttpError(404, 'Document introuvable');

    const absolutePath = path.join(env.UPLOAD_DIR, path.basename(document.storage_path));
    if (!fs.existsSync(absolutePath)) throw new HttpError(404, 'Fichier introuvable sur le serveur');

    await writeAuditLog({
      userId: req.user!.id,
      action: 'DOCUMENT_DOWNLOADED',
      entityType: 'library_document',
      entityId: document.id,
      details: { filename: document.filename },
      ipAddress: req.ip,
    });

    res.download(absolutePath, document.filename);
  })
);
