import { pool } from '../db/pool';
import { PermissionMatrixRow } from '../types';

/**
 * La matrice de permissions est une couche de configuration fine
 * OPTIONNELLE : en l'absence de ligne pour (processus, étape, rôle), l'accès
 * par défaut reste ouvert aux participants légitimes de l'instance (déjà
 * filtrés en amont par les routes : titulaire de l'instance, assigné de la
 * tâche courante, membre du pool de rôle, ou ADMIN). Dès qu'une ligne existe
 * pour un rôle donné, elle devient la source de vérité pour ce rôle.
 */

export async function getPermissionRows(
  processId: string,
  stepName: string,
  roleIds: number[]
): Promise<PermissionMatrixRow[]> {
  if (roleIds.length === 0) return [];
  const { rows } = await pool.query<PermissionMatrixRow>(
    `SELECT * FROM permissions_matrix WHERE process_id = $1 AND step_name = $2 AND role_id = ANY($3::int[])`,
    [processId, stepName, roleIds]
  );
  return rows;
}

export function filterFormDataForUser(
  formData: Record<string, unknown>,
  matrixRows: PermissionMatrixRow[],
  isAdmin: boolean
): Record<string, unknown> {
  if (isAdmin || matrixRows.length === 0) return formData;

  const readableKeys = new Set<string>();
  for (const row of matrixRows) {
    for (const [key, perm] of Object.entries(row.field_permissions)) {
      if (perm.read) readableKeys.add(key);
    }
  }

  const filtered: Record<string, unknown> = {};
  for (const key of Object.keys(formData)) {
    if (readableKeys.has(key)) filtered[key] = formData[key];
  }
  return filtered;
}

export function writableFieldKeys(matrixRows: PermissionMatrixRow[], isAdmin: boolean): Set<string> | null {
  if (isAdmin || matrixRows.length === 0) return null; // null = pas de restriction
  const keys = new Set<string>();
  for (const row of matrixRows) {
    for (const [key, perm] of Object.entries(row.field_permissions)) {
      if (perm.write) keys.add(key);
    }
  }
  return keys;
}

export async function canViewDocuments(
  processId: string,
  stepName: string,
  roleIds: number[],
  isAdmin: boolean
): Promise<boolean> {
  if (isAdmin) return true;
  const rows = await getPermissionRows(processId, stepName, roleIds);
  if (rows.length === 0) return true;
  return rows.some((r) => r.can_view_documents);
}

export async function canUploadDocuments(
  processId: string,
  stepName: string,
  roleIds: number[],
  isAdmin: boolean
): Promise<boolean> {
  if (isAdmin) return true;
  const rows = await getPermissionRows(processId, stepName, roleIds);
  if (rows.length === 0) return true;
  return rows.some((r) => r.can_upload_documents);
}
