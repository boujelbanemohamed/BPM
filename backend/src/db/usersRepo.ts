import { Pool, PoolClient } from 'pg';
import { AuthenticatedUser, PublicUser, User } from '../types';

/**
 * Toute lecture utilisateur doit passer par un exécuteur explicite (le pool
 * global, ou le client d'une transaction en cours) afin de rester cohérente
 * avec les écritures non encore committées de cette même transaction
 * (ex. désactivation de compte suivie immédiatement de la résolution de la
 * chaîne de suppléance).
 */
export type Executor = Pool | PoolClient;

interface UserWithRoles extends User {
  role_names: string[] | null;
  role_ids: number[] | null;
}

const BASE_SELECT = `
  SELECT u.*,
         COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS role_names,
         COALESCE(array_agg(r.id) FILTER (WHERE r.id IS NOT NULL), '{}') AS role_ids
  FROM users u
  LEFT JOIN user_roles ur ON ur.user_id = u.id
  LEFT JOIN roles r ON r.id = ur.role_id
`;

function toAuthenticatedUser(row: UserWithRoles): AuthenticatedUser {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
    avatarUrl: row.avatar_url,
    emailNotificationsEnabled: row.email_notifications_enabled,
    isActive: row.is_active,
    absenceStart: row.absence_start,
    absenceEnd: row.absence_end,
    delegateUser1Id: row.delegate_user_1_id,
    delegateUser2Id: row.delegate_user_2_id,
    twoFactorEnabled: row.two_factor_enabled,
    roles: row.role_names ?? [],
    roleIds: row.role_ids ?? [],
  };
}

export function toPublicUser(user: AuthenticatedUser): PublicUser {
  const { roleIds, ...rest } = user;
  return rest;
}

export async function findUserByEmail(
  executor: Executor,
  email: string
): Promise<(UserWithRoles & { authUser: AuthenticatedUser }) | null> {
  const result = await executor.query<UserWithRoles>(`${BASE_SELECT} WHERE u.email = $1 GROUP BY u.id`, [email]);
  const row = result.rows[0];
  if (!row) return null;
  return { ...row, authUser: toAuthenticatedUser(row) };
}

export async function findUserById(executor: Executor, id: string): Promise<AuthenticatedUser | null> {
  const result = await executor.query<UserWithRoles>(`${BASE_SELECT} WHERE u.id = $1 GROUP BY u.id`, [id]);
  const row = result.rows[0];
  return row ? toAuthenticatedUser(row) : null;
}

export async function listUsers(executor: Executor): Promise<AuthenticatedUser[]> {
  const result = await executor.query<UserWithRoles>(`${BASE_SELECT} GROUP BY u.id ORDER BY u.full_name ASC`);
  return result.rows.map(toAuthenticatedUser);
}
