import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { requirePageAccess } from '../middleware/pageAccess';
import { asyncHandler } from '../middleware/asyncHandler';
import { paginationClause, paginationQuerySchema } from '../lib/pagination';
import { toCsv } from '../lib/csv';
import { AuditLogRow } from '../types';

export const auditRouter = Router();
auditRouter.use(requireAuth, requirePageAccess('AUDIT', 'VIEW'));

const auditFiltersSchema = z.object({
  userId: z.string().uuid().optional(),
  action: z.string().optional(),
  entityType: z.string().optional(),
});

const querySchema = paginationQuerySchema.merge(auditFiltersSchema);

function buildAuditFilter(filters: z.infer<typeof auditFiltersSchema>): { where: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.userId) {
    params.push(filters.userId);
    conditions.push(`al.user_id = $${params.length}`);
  }
  if (filters.action) {
    params.push(filters.action);
    conditions.push(`al.action = $${params.length}`);
  }
  if (filters.entityType) {
    params.push(filters.entityType);
    conditions.push(`al.entity_type = $${params.length}`);
  }

  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

const AUDIT_EXPORT_LIMIT = 5000;

auditRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = querySchema.parse(req.query);
    const { where, params } = buildAuditFilter(q);
    const filterParamCount = params.length;

    const { rows } = await pool.query<AuditLogRow & { actor_name: string | null }>(
      `SELECT al.*, u.full_name AS actor_name
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
       ${where}
       ORDER BY al.created_at DESC
       ${paginationClause(params, q)}`,
      params
    );

    const { rows: countRows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text FROM audit_logs al ${where}`,
      params.slice(0, filterParamCount)
    );

    res.json({ logs: rows, total: Number(countRows[0].count) });
  })
);

auditRouter.get(
  '/export.csv',
  asyncHandler(async (req, res) => {
    const filters = auditFiltersSchema.parse(req.query);
    const { where, params } = buildAuditFilter(filters);

    const { rows } = await pool.query<AuditLogRow & { actor_name: string | null }>(
      `SELECT al.*, u.full_name AS actor_name
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
       ${where}
       ORDER BY al.created_at DESC
       LIMIT ${AUDIT_EXPORT_LIMIT}`,
      params
    );

    const csv = toCsv(
      ['Date', 'Acteur', 'Action', 'Type entité', 'ID entité', 'Détails', 'IP'],
      rows.map((r) => [
        new Date(r.created_at).toLocaleString('fr-FR'),
        r.actor_name ?? '',
        r.action,
        r.entity_type,
        r.entity_id ?? '',
        JSON.stringify(r.details ?? {}),
        r.ip_address ?? '',
      ])
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="audit_export.csv"');
    res.send(`﻿${csv}`);
  })
);
