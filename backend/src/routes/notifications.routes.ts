import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { HttpError } from '../middleware/errorHandler';
import { paginationClause, paginationQuerySchema } from '../lib/pagination';
import { NotificationRow } from '../types';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const pagination = paginationQuerySchema.parse(req.query);
    const params: unknown[] = [req.user!.id];

    const { rows } = await pool.query<NotificationRow>(
      `SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC ${paginationClause(params, pagination)}`,
      params
    );

    const { rows: countRows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text FROM notifications WHERE user_id = $1`,
      [req.user!.id]
    );

    res.json({ notifications: rows, total: Number(countRows[0].count) });
  })
);

notificationsRouter.get(
  '/unread-count',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text FROM notifications WHERE user_id = $1 AND is_read = FALSE`,
      [req.user!.id]
    );
    res.json({ count: Number(rows[0].count) });
  })
);

notificationsRouter.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query<NotificationRow>(
      `UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2 RETURNING *`,
      [req.params.id, req.user!.id]
    );
    if (rows.length === 0) throw new HttpError(404, 'Notification introuvable');
    res.json({ notification: rows[0] });
  })
);

notificationsRouter.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    await pool.query(`UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE`, [
      req.user!.id,
    ]);
    res.json({ ok: true });
  })
);
