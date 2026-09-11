import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { HttpError } from '../middleware/errorHandler';
import { writeAuditLog } from '../lib/audit';
import { paginationClause, paginationQuerySchema } from '../lib/pagination';
import { ClientRow, ProcessInstanceRow } from '../types';

export const clientsRouter = Router();
clientsRouter.use(requireAuth);

clientsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const pagination = paginationQuerySchema.parse(req.query);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const params: unknown[] = [q];

    const { rows } = await pool.query<ClientRow & { instance_count: string }>(
      `SELECT c.*, count(pi.id)::text AS instance_count
       FROM clients c
       LEFT JOIN process_instances pi ON pi.client_id = c.id
       WHERE $1 = '' OR c.name ILIKE '%' || $1 || '%'
       GROUP BY c.id
       ORDER BY c.name ASC
       ${paginationClause(params, pagination)}`,
      params
    );

    const { rows: countRows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text FROM clients c WHERE $1 = '' OR c.name ILIKE '%' || $1 || '%'`,
      [q]
    );

    res.json({ clients: rows, total: Number(countRows[0].count) });
  })
);

const clientSchema = z.object({
  name: z.string().min(2, 'Le nom du client doit contenir au moins 2 caractères'),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
});

clientsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = clientSchema.parse(req.body);
    const { rows } = await pool.query<ClientRow>(
      `INSERT INTO clients (name, email, phone, address, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [body.name, body.email || null, body.phone || null, body.address || null, body.notes || null, req.user!.id]
    );

    await writeAuditLog({
      userId: req.user!.id,
      action: 'CLIENT_CREATED',
      entityType: 'client',
      entityId: rows[0].id,
      details: { name: body.name },
      ipAddress: req.ip,
    });

    res.status(201).json({ client: rows[0] });
  })
);

clientsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query<ClientRow>('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    const client = rows[0];
    if (!client) throw new HttpError(404, 'Client introuvable');

    const { rows: instances } = await pool.query<
      ProcessInstanceRow & { process_name: string; started_by_name: string }
    >(
      `SELECT pi.*, p.name AS process_name, u.full_name AS started_by_name
       FROM process_instances pi
       JOIN processes p ON p.id = pi.process_id
       JOIN users u ON u.id = pi.started_by
       WHERE pi.client_id = $1
       ORDER BY pi.started_at DESC`,
      [client.id]
    );

    res.json({ client, instances });
  })
);

const updateClientSchema = clientSchema.partial();

clientsRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const body = updateClientSchema.parse(req.body);
    const { rows: existingRows } = await pool.query<ClientRow>('SELECT * FROM clients WHERE id = $1', [
      req.params.id,
    ]);
    const existing = existingRows[0];
    if (!existing) throw new HttpError(404, 'Client introuvable');

    const { rows } = await pool.query<ClientRow>(
      `UPDATE clients SET name = $1, email = $2, phone = $3, address = $4, notes = $5 WHERE id = $6 RETURNING *`,
      [
        body.name ?? existing.name,
        body.email !== undefined ? body.email || null : existing.email,
        body.phone !== undefined ? body.phone || null : existing.phone,
        body.address !== undefined ? body.address || null : existing.address,
        body.notes !== undefined ? body.notes || null : existing.notes,
        existing.id,
      ]
    );

    await writeAuditLog({
      userId: req.user!.id,
      action: 'CLIENT_UPDATED',
      entityType: 'client',
      entityId: existing.id,
      ipAddress: req.ip,
    });

    res.json({ client: rows[0] });
  })
);
