import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { requireAuth, requireRole } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { HttpError } from '../middleware/errorHandler';
import { writeAuditLog } from '../lib/audit';
import { Role, RoleWithUsers } from '../types';

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
  requireRole('ADMIN'),
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

    const overview: RoleWithUsers[] = roles.map((role) => ({
      ...role,
      users: userRows
        .filter((u) => u.role_id === role.id)
        .map((u) => ({ id: u.id, fullName: u.full_name, email: u.email, isActive: u.is_active })),
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
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const body = createRoleSchema.parse(req.body);
    const name = body.name.toUpperCase();

    const { rows: existing } = await pool.query('SELECT id FROM roles WHERE name = $1', [name]);
    if (existing.length > 0) throw new HttpError(409, 'Un rôle avec ce nom existe déjà');

    const { rows } = await pool.query<Role>(
      'INSERT INTO roles (name, description) VALUES ($1, $2) RETURNING id, name, description',
      [name, body.description || null]
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
  requireRole('ADMIN'),
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
