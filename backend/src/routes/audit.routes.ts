import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { requireAuth, requireRole } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { AuditLogRow } from '../types';

export const auditRouter = Router();
auditRouter.use(requireAuth, requireRole('ADMIN'));

const querySchema = z.object({
  userId: z.string().uuid().optional(),
  action: z.string().optional(),
  entityType: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

auditRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = querySchema.parse(req.query);

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (q.userId) {
      params.push(q.userId);
      conditions.push(`al.user_id = $${params.length}`);
    }
    if (q.action) {
      params.push(q.action);
      conditions.push(`al.action = $${params.length}`);
    }
    if (q.entityType) {
      params.push(q.entityType);
      conditions.push(`al.entity_type = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(q.limit);
    const limitParam = params.length;
    params.push(q.offset);
    const offsetParam = params.length;

    const { rows } = await pool.query<AuditLogRow & { actor_name: string | null }>(
      `SELECT al.*, u.full_name AS actor_name
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
       ${where}
       ORDER BY al.created_at DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      params
    );

    const { rows: countRows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text FROM audit_logs al ${where}`,
      params.slice(0, conditions.length)
    );

    res.json({ logs: rows, total: Number(countRows[0].count) });
  })
);
