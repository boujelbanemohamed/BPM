import { PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import { listUsers, listUsersPage } from './usersRepo';
import { withRollback } from '../test/dbTestHelpers';

const UNIQUE = `usersrepo-test-${Date.now()}`;

async function createTestUser(
  client: PoolClient,
  index: number,
  twoFactorEnabled = false,
  isActive = true
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name, two_factor_enabled, is_active)
     VALUES ($1, 'x', $2, $3, $4) RETURNING id`,
    [`${UNIQUE}-${index}@test.local`, `ZZZ Test User ${UNIQUE} ${index}`, twoFactorEnabled, isActive]
  );
  return rows[0].id;
}

describe('usersRepo — listUsersPage', () => {
  it('paginates users with limit/offset and reports the global total, not just the page size', async () => {
    await withRollback(async (client) => {
      await createTestUser(client, 1);
      await createTestUser(client, 2);
      await createTestUser(client, 3);

      const baseline = await listUsers(client);
      const expectedTotal = baseline.length;

      const page1 = await listUsersPage(client, { limit: 2, offset: 0 });
      expect(page1.users).toHaveLength(2);
      expect(page1.total).toBe(expectedTotal);

      const page2 = await listUsersPage(client, { limit: 2, offset: 2 });
      expect(page2.total).toBe(expectedTotal);

      const page1Ids = new Set(page1.users.map((u) => u.id));
      for (const u of page2.users) {
        expect(page1Ids.has(u.id)).toBe(false);
      }
    });
  });

  it('computes twoFactorEnabledCount across all users, independent of the requested page size', async () => {
    await withRollback(async (client) => {
      await createTestUser(client, 1, true);
      await createTestUser(client, 2, true);
      await createTestUser(client, 3, false);

      const allUsers = await listUsers(client);
      const expectedTwoFactorCount = allUsers.filter((u) => u.twoFactorEnabled).length;

      // Une page de taille 1 ne renvoie qu'un seul des utilisateurs créés
      // ci-dessus : le compte 2FA doit malgré tout refléter l'ensemble des
      // comptes, pas seulement ceux visibles sur cette page.
      const page = await listUsersPage(client, { limit: 1, offset: 0 });
      expect(page.twoFactorEnabledCount).toBe(expectedTwoFactorCount);
    });
  });

  it('filters by q (name/email substring), scoping total and twoFactorEnabledCount to the match', async () => {
    await withRollback(async (client) => {
      const id1 = await createTestUser(client, 1, true);
      await createTestUser(client, 2, false);

      const page = await listUsersPage(client, { limit: 10, offset: 0 }, { q: `${UNIQUE}-1` });
      expect(page.users.map((u) => u.id)).toEqual([id1]);
      expect(page.total).toBe(1);
      expect(page.twoFactorEnabledCount).toBe(1);
    });
  });

  it('filters by status active/inactive', async () => {
    await withRollback(async (client) => {
      const activeId = await createTestUser(client, 1, false, true);
      const inactiveId = await createTestUser(client, 2, false, false);

      const active = await listUsersPage(client, { limit: 10, offset: 0 }, { q: UNIQUE, status: 'active' });
      expect(active.users.map((u) => u.id)).toEqual([activeId]);

      const inactive = await listUsersPage(client, { limit: 10, offset: 0 }, { q: UNIQUE, status: 'inactive' });
      expect(inactive.users.map((u) => u.id)).toEqual([inactiveId]);
    });
  });

  it('filters by role name', async () => {
    await withRollback(async (client) => {
      const withRoleId = await createTestUser(client, 1);
      await createTestUser(client, 2);
      const { rows: roleRows } = await client.query<{ id: number }>(`SELECT id FROM roles WHERE name = 'OPERATOR'`);
      await client.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [withRoleId, roleRows[0].id]);

      const page = await listUsersPage(client, { limit: 10, offset: 0 }, { q: UNIQUE, role: 'OPERATOR' });
      expect(page.users.map((u) => u.id)).toEqual([withRoleId]);
    });
  });
});
