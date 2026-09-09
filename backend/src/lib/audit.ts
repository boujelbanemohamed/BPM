import { PoolClient } from 'pg';
import { pool } from '../db/pool';
import { logger } from './logger';

export interface AuditEntry {
  userId: string | null;
  action: string;
  entityType?: string;
  entityId?: string | null;
  details?: Record<string, unknown>;
  ipAddress?: string | null;
}

async function insert(client: PoolClient | typeof pool, entry: AuditEntry): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      entry.userId,
      entry.action,
      entry.entityType ?? null,
      entry.entityId ?? null,
      JSON.stringify(entry.details ?? {}),
      entry.ipAddress ?? null,
    ]
  );
}

export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  try {
    await insert(pool, entry);
  } catch (err) {
    logger.error('Failed to write audit log', { error: (err as Error).message, entry });
  }
}

export async function writeAuditLogTx(client: PoolClient, entry: AuditEntry): Promise<void> {
  await insert(client, entry);
}
