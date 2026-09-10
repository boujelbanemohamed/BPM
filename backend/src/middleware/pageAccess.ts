import { NextFunction, Request, Response } from 'express';
import { pool } from '../db/pool';
import { asyncHandler } from './asyncHandler';
import { HttpError } from './errorHandler';
import { PageAccessLevel, PageKey } from '../types';

const LEVEL_RANK: Record<PageAccessLevel, number> = { NONE: 0, VIEW: 1, FULL: 2 };

export function levelAtLeast(level: PageAccessLevel, min: PageAccessLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[min];
}

/**
 * Calcule le niveau d'accès effectif d'un utilisateur pour une page : ADMIN
 * a toujours FULL ; sinon le meilleur niveau parmi les rôles qu'il possède
 * (l'absence de ligne pour un rôle vaut NONE).
 */
export async function getEffectiveLevel(
  roles: string[],
  roleIds: number[],
  pageKey: PageKey
): Promise<PageAccessLevel> {
  if (roles.includes('ADMIN')) return 'FULL';
  if (roleIds.length === 0) return 'NONE';

  const { rows } = await pool.query<{ access_level: PageAccessLevel }>(
    `SELECT access_level FROM role_page_permissions WHERE role_id = ANY($1::int[]) AND page_key = $2`,
    [roleIds, pageKey]
  );
  return rows.reduce<PageAccessLevel>(
    (best, r) => (LEVEL_RANK[r.access_level] > LEVEL_RANK[best] ? r.access_level : best),
    'NONE'
  );
}

/** Calcule l'accès effectif de l'utilisateur pour toutes les pages du catalogue, en une requête. */
export async function getAllEffectiveLevels(
  roles: string[],
  roleIds: number[],
  pageKeys: readonly PageKey[]
): Promise<Record<PageKey, PageAccessLevel>> {
  const isAdmin = roles.includes('ADMIN');
  const result = {} as Record<PageKey, PageAccessLevel>;
  for (const key of pageKeys) result[key] = isAdmin ? 'FULL' : 'NONE';
  if (isAdmin || roleIds.length === 0) return result;

  const { rows } = await pool.query<{ page_key: PageKey; access_level: PageAccessLevel }>(
    `SELECT page_key, access_level FROM role_page_permissions WHERE role_id = ANY($1::int[])`,
    [roleIds]
  );
  for (const row of rows) {
    if (LEVEL_RANK[row.access_level] > LEVEL_RANK[result[row.page_key]]) {
      result[row.page_key] = row.access_level;
    }
  }
  return result;
}

export function requirePageAccess(pageKey: PageKey, minLevel: PageAccessLevel) {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    const level = await getEffectiveLevel(req.user!.roles, req.user!.roleIds, pageKey);
    if (!levelAtLeast(level, minLevel)) {
      throw new HttpError(403, "Vous n'avez pas les droits nécessaires pour cette action");
    }
    next();
  });
}
