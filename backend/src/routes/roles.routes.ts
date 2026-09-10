import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { HttpError } from '../middleware/errorHandler';
import { writeAuditLog, writeAuditLogTx } from '../lib/audit';
import { requirePageAccess } from '../middleware/pageAccess';
import { parseGraph } from '../services/workflowEngine';
import {
  PAGE_KEYS,
  PageAccessLevel,
  PageKey,
  PermissionMatrixRow,
  ProcessRow,
  Role,
  RoleAssignedTask,
  RolePermissionRule,
  RoleWithUsers,
} from '../types';

export const rolesRouter = Router();
rolesRouter.use(requireAuth);

rolesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query<Role>('SELECT id, name, description FROM roles ORDER BY name ASC');
    res.json({ roles: rows });
  })
);

/** Vue admin : chaque rôle avec la liste des utilisateurs qui le possèdent. */
rolesRouter.get(
  '/overview',
  requirePageAccess('ROLES', 'VIEW'),
  asyncHandler(async (req, res) => {
    const { rows: roles } = await pool.query<Role>('SELECT id, name, description FROM roles ORDER BY name ASC');
    const { rows: userRows } = await pool.query<{
      role_id: number;
      id: string;
      full_name: string;
      email: string;
      is_active: boolean;
    }>(
      `SELECT ur.role_id, u.id, u.full_name, u.email, u.is_active
       FROM user_roles ur
       JOIN users u ON u.id = ur.user_id
       ORDER BY u.full_name ASC`
    );

    // Tâches BPMN réellement assignées à chaque rôle, calculées en scannant
    // tous les processus (le rôle est référencé par son nom dans le XML).
    const { rows: processes } = await pool.query<ProcessRow>('SELECT * FROM processes ORDER BY name ASC, version DESC');
    const assignedTasksByRoleName = new Map<string, RoleAssignedTask[]>();
    for (const process of processes) {
      let graph;
      try {
        graph = parseGraph(process.bpmn_xml);
      } catch {
        continue; // processus au XML invalide : on l'ignore plutôt que de faire échouer tout le registre
      }
      for (const node of graph.nodes) {
        if (node.type !== 'userTask' || !node.assigneeRole) continue;
        const list = assignedTasksByRoleName.get(node.assigneeRole) ?? [];
        list.push({
          processId: process.id,
          processName: process.name,
          processStatus: process.status,
          stepName: node.name,
        });
        assignedTasksByRoleName.set(node.assigneeRole, list);
      }
    }

    // Lignes de la matrice de droits qui concernent chaque rôle.
    const { rows: matrixRows } = await pool.query<PermissionMatrixRow & { process_name: string }>(
      `SELECT pm.*, p.name AS process_name
       FROM permissions_matrix pm
       JOIN processes p ON p.id = pm.process_id
       ORDER BY p.name ASC, pm.step_name ASC`
    );

    // Accès aux pages configuré pour chaque rôle (ADMIN a toujours FULL
    // partout et n'a jamais de ligne dans role_page_permissions).
    const { rows: pageAccessRows } = await pool.query<{
      role_id: number;
      page_key: PageKey;
      access_level: PageAccessLevel;
    }>('SELECT role_id, page_key, access_level FROM role_page_permissions');

    function buildPageAccess(role: Role): Record<PageKey, PageAccessLevel> {
      const result = {} as Record<PageKey, PageAccessLevel>;
      for (const key of PAGE_KEYS) result[key] = role.name === 'ADMIN' ? 'FULL' : 'NONE';
      if (role.name !== 'ADMIN') {
        for (const row of pageAccessRows) {
          if (row.role_id === role.id) result[row.page_key] = row.access_level;
        }
      }
      return result;
    }

    const overview: RoleWithUsers[] = roles.map((role) => ({
      ...role,
      users: userRows
        .filter((u) => u.role_id === role.id)
        .map((u) => ({ id: u.id, fullName: u.full_name, email: u.email, isActive: u.is_active })),
      assignedTasks: assignedTasksByRoleName.get(role.name) ?? [],
      permissionRules: matrixRows
        .filter((r) => r.role_id === role.id)
        .map(
          (r): RolePermissionRule => ({
            processId: r.process_id,
            processName: r.process_name,
            stepName: r.step_name,
            fieldCount: Object.keys(r.field_permissions ?? {}).length,
            canViewDocuments: r.can_view_documents,
            canUploadDocuments: r.can_upload_documents,
          })
        ),
      pageAccess: buildPageAccess(role),
    }));

    res.json({ roles: overview });
  })
);

const createRoleSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Le nom du rôle doit contenir au moins 2 caractères')
    .max(50)
    .regex(/^[A-Za-z0-9_]+$/, 'Le nom du rôle ne peut contenir que des lettres, chiffres et underscores'),
  description: z.string().trim().max(255).optional(),
});

rolesRouter.post(
  '/',
  requirePageAccess('ROLES', 'FULL'),
  asyncHandler(async (req, res) => {
    const body = createRoleSchema.parse(req.body);
    const name = body.name.toUpperCase();

    const { rows: existing } = await pool.query('SELECT id FROM roles WHERE name = $1', [name]);
    if (existing.length > 0) throw new HttpError(409, 'Un rôle avec ce nom existe déjà');

    const { rows } = await pool.query<Role>(
      'INSERT INTO roles (name, description) VALUES ($1, $2) RETURNING id, name, description',
      [name, body.description || null]
    );

    // Accès par défaut d'un nouveau rôle : consultation des processus,
    // comme les autres rôles non-admin (le reste démarre à NONE).
    await pool.query(
      `INSERT INTO role_page_permissions (role_id, page_key, access_level, updated_by)
       VALUES ($1, 'PROCESSES_DESIGN', 'VIEW', $2)`,
      [rows[0].id, req.user!.id]
    );

    await writeAuditLog({
      userId: req.user!.id,
      action: 'ROLE_CREATED',
      entityType: 'role',
      entityId: String(rows[0].id),
      details: { name, description: body.description ?? null },
      ipAddress: req.ip,
    });

    res.status(201).json({ role: rows[0] });
  })
);

const updateRoleSchema = z.object({
  description: z.string().trim().max(255).nullable(),
});

/** Seule la description est modifiable : le nom est référencé par sa valeur
 *  littérale dans le XML BPMN (bpm:assigneeRole) et la matrice de droits par
 *  role_id ; le renommer casserait silencieusement ces références. */
rolesRouter.put(
  '/:id',
  requirePageAccess('ROLES', 'FULL'),
  asyncHandler(async (req, res) => {
    const body = updateRoleSchema.parse(req.body);
    const { rows } = await pool.query<Role>(
      'UPDATE roles SET description = $1 WHERE id = $2 RETURNING id, name, description',
      [body.description || null, req.params.id]
    );
    if (rows.length === 0) throw new HttpError(404, 'Rôle introuvable');

    await writeAuditLog({
      userId: req.user!.id,
      action: 'ROLE_UPDATED',
      entityType: 'role',
      entityId: req.params.id,
      details: { description: body.description ?? null },
      ipAddress: req.ip,
    });

    res.json({ role: rows[0] });
  })
);

const pageAccessSchema = z.object({
  pageAccess: z.record(z.enum(['NONE', 'VIEW', 'FULL'])),
});

/**
 * Remplace intégralement l'accès aux pages d'un rôle. Le rôle ADMIN n'est
 * jamais configurable ici : il a toujours accès complet à tout.
 *
 * Accorder FULL sur la page "Rôles" à un rôle non-admin lui donne le
 * pouvoir de modifier les accès de tous les rôles, y compris les siens —
 * c'est une délégation consciente, au même titre que le reste de cette
 * fonctionnalité.
 */
rolesRouter.put(
  '/:id/page-access',
  requirePageAccess('ROLES', 'FULL'),
  asyncHandler(async (req, res) => {
    const body = pageAccessSchema.parse(req.body);
    const roleId = Number(req.params.id);
    if (!Number.isInteger(roleId)) throw new HttpError(400, 'Identifiant de rôle invalide');

    const { rows: roleRows } = await pool.query<Role>('SELECT id, name, description FROM roles WHERE id = $1', [
      roleId,
    ]);
    const role = roleRows[0];
    if (!role) throw new HttpError(404, 'Rôle introuvable');
    if (role.name === 'ADMIN') {
      throw new HttpError(400, "Le rôle ADMIN a toujours accès à tout : ses accès ne sont pas configurables");
    }

    await withTransaction(async (client) => {
      for (const [pageKey, level] of Object.entries(body.pageAccess)) {
        if (!(PAGE_KEYS as readonly string[]).includes(pageKey)) continue;
        await client.query(
          `INSERT INTO role_page_permissions (role_id, page_key, access_level, updated_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (role_id, page_key)
           DO UPDATE SET access_level = EXCLUDED.access_level, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [roleId, pageKey, level, req.user!.id]
        );
      }

      await writeAuditLogTx(client, {
        userId: req.user!.id,
        action: 'ROLE_PAGE_ACCESS_UPDATED',
        entityType: 'role',
        entityId: String(roleId),
        details: body.pageAccess,
        ipAddress: req.ip,
      });
    });

    res.json({ ok: true });
  })
);
