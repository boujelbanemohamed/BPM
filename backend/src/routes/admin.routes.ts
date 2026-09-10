import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool, withTransaction } from '../db/pool';
import { requireAuth, requireRole } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { env } from '../config/env';
import { findUserById, toPublicUser } from '../db/usersRepo';
import { writeAuditLog, writeAuditLogTx } from '../lib/audit';
import { HttpError } from '../middleware/errorHandler';
import { reassignPendingTasksForUser } from '../services/delegationService';
import { notifyAccountDeactivated, notifyPasswordChanged, notifyTaskAssigned, notifyWelcome } from '../services/notificationService';

export const adminUsersRouter = Router();
adminUsersRouter.use(requireAuth, requireRole('ADMIN'));

adminUsersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query<{ id: string }>('SELECT id FROM users ORDER BY full_name ASC');
    const users = await Promise.all(rows.map((r) => findUserById(pool, r.id)));
    res.json({ users: users.filter(Boolean).map((u) => toPublicUser(u!)) });
  })
);

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Le mot de passe doit contenir au moins 8 caractères'),
  firstName: z.string().trim().min(1, 'Le prénom est requis').max(255),
  lastName: z.string().trim().min(1, 'Le nom est requis').max(255),
  phone: z.string().trim().max(50).nullable().optional(),
  roleNames: z.array(z.string()).min(1, 'Au moins un rôle est requis'),
});

adminUsersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createUserSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(body.password, env.BCRYPT_ROUNDS);
    const fullName = `${body.firstName} ${body.lastName}`.trim();

    const created = await withTransaction(async (client) => {
      const { rows: existing } = await client.query('SELECT id FROM users WHERE email = $1', [body.email]);
      if (existing.length > 0) throw new HttpError(409, 'Un utilisateur avec cet email existe déjà');

      const { rows: userRows } = await client.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, full_name, first_name, last_name, phone)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [body.email, passwordHash, fullName, body.firstName, body.lastName, body.phone || null]
      );
      const userId = userRows[0].id;

      const { rows: roleRows } = await client.query<{ id: number }>(
        `SELECT id FROM roles WHERE name = ANY($1::text[])`,
        [body.roleNames]
      );
      if (roleRows.length !== body.roleNames.length) {
        throw new HttpError(400, 'Un ou plusieurs rôles spécifiés sont inconnus');
      }
      for (const role of roleRows) {
        await client.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [userId, role.id]);
      }

      await writeAuditLogTx(client, {
        userId: req.user!.id,
        action: 'USER_CREATED',
        entityType: 'user',
        entityId: userId,
        details: { email: body.email, roleNames: body.roleNames },
        ipAddress: req.ip,
      });

      await notifyWelcome(client, {
        userId,
        email: body.email,
        fullName,
        temporaryPassword: body.password,
      });

      return userId;
    });

    const user = await findUserById(pool, created);
    res.status(201).json({ user: toPublicUser(user!) });
  })
);

const updateUserSchema = z
  .object({
    firstName: z.string().trim().min(1, 'Le prénom est requis').max(255).optional(),
    lastName: z.string().trim().min(1, 'Le nom est requis').max(255).optional(),
    phone: z.string().trim().max(50).nullable().optional(),
    email: z.string().email().optional(),
    password: z.string().min(8, 'Le mot de passe doit contenir au moins 8 caractères').optional(),
    roleNames: z.array(z.string()).min(1).optional(),
    delegateUser1Id: z.string().uuid().nullable().optional(),
    delegateUser2Id: z.string().uuid().nullable().optional(),
    absenceStart: z.string().nullable().optional(),
    absenceEnd: z.string().nullable().optional(),
  })
  .refine(
    (data) => !data.delegateUser1Id || !data.delegateUser2Id || data.delegateUser1Id !== data.delegateUser2Id,
    { message: 'Suppléant 1 et Suppléant 2 doivent être des utilisateurs différents' }
  );

adminUsersRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const body = updateUserSchema.parse(req.body);
    const targetId = req.params.id;

    if (body.delegateUser1Id === targetId || body.delegateUser2Id === targetId) {
      throw new HttpError(400, 'Un utilisateur ne peut pas être son propre suppléant');
    }

    await withTransaction(async (client) => {
      const target = await findUserById(client, targetId);
      if (!target) throw new HttpError(404, 'Utilisateur introuvable');

      if (body.email !== undefined) {
        const { rows: emailClash } = await client.query('SELECT id FROM users WHERE email = $1 AND id <> $2', [
          body.email,
          targetId,
        ]);
        if (emailClash.length > 0) throw new HttpError(409, 'Cette adresse email est déjà utilisée par un autre compte');
        await client.query('UPDATE users SET email = $1 WHERE id = $2', [body.email, targetId]);
      }

      if (body.firstName !== undefined || body.lastName !== undefined) {
        const firstName = body.firstName ?? target.firstName ?? '';
        const lastName = body.lastName ?? target.lastName ?? '';
        const fullName = `${firstName} ${lastName}`.trim();
        await client.query('UPDATE users SET first_name = $1, last_name = $2, full_name = $3 WHERE id = $4', [
          firstName,
          lastName,
          fullName,
          targetId,
        ]);
      }

      if (body.phone !== undefined) {
        await client.query('UPDATE users SET phone = $1 WHERE id = $2', [body.phone || null, targetId]);
      }

      if (body.password !== undefined) {
        const passwordHash = await bcrypt.hash(body.password, env.BCRYPT_ROUNDS);
        await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, targetId]);

        await notifyPasswordChanged(client, {
          userId: targetId,
          email: body.email ?? target.email,
          fullName: `${body.firstName ?? target.firstName ?? ''} ${body.lastName ?? target.lastName ?? ''}`.trim() || target.fullName,
          changedByAdmin: true,
        });
      }

      if (body.delegateUser1Id !== undefined) {
        await client.query('UPDATE users SET delegate_user_1_id = $1 WHERE id = $2', [
          body.delegateUser1Id,
          targetId,
        ]);
      }
      if (body.delegateUser2Id !== undefined) {
        await client.query('UPDATE users SET delegate_user_2_id = $1 WHERE id = $2', [
          body.delegateUser2Id,
          targetId,
        ]);
      }
      if (body.absenceStart !== undefined || body.absenceEnd !== undefined) {
        await client.query('UPDATE users SET absence_start = $1, absence_end = $2 WHERE id = $3', [
          body.absenceStart ?? null,
          body.absenceEnd ?? null,
          targetId,
        ]);
      }
      if (body.roleNames) {
        const { rows: roleRows } = await client.query<{ id: number }>(
          `SELECT id FROM roles WHERE name = ANY($1::text[])`,
          [body.roleNames]
        );
        if (roleRows.length !== body.roleNames.length) {
          throw new HttpError(400, 'Un ou plusieurs rôles spécifiés sont inconnus');
        }
        await client.query('DELETE FROM user_roles WHERE user_id = $1', [targetId]);
        for (const role of roleRows) {
          await client.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [targetId, role.id]);
        }
      }

      await writeAuditLogTx(client, {
        userId: req.user!.id,
        action: 'USER_UPDATED',
        entityType: 'user',
        entityId: targetId,
        details: { ...body, password: body.password !== undefined ? '[REDACTED]' : undefined },
        ipAddress: req.ip,
      });

      if (body.password !== undefined) {
        await writeAuditLogTx(client, {
          userId: req.user!.id,
          action: 'PASSWORD_RESET_BY_ADMIN',
          entityType: 'user',
          entityId: targetId,
          ipAddress: req.ip,
        });
      }
    });

    const updated = await findUserById(pool, targetId);
    if (!updated) throw new HttpError(404, 'Utilisateur introuvable');
    res.json({ user: toPublicUser(updated) });
  })
);

adminUsersRouter.post(
  '/:id/deactivate',
  asyncHandler(async (req, res) => {
    const targetId = req.params.id;
    if (targetId === req.user!.id) {
      throw new HttpError(400, 'Vous ne pouvez pas désactiver votre propre compte');
    }

    const target = await findUserById(pool, targetId);
    if (!target) throw new HttpError(404, 'Utilisateur introuvable');
    if (!target.isActive) throw new HttpError(409, 'Ce compte est déjà désactivé');

    const reassignments = await withTransaction(async (client) => {
      await client.query('UPDATE users SET is_active = FALSE WHERE id = $1', [targetId]);

      const results = await reassignPendingTasksForUser(client, targetId);

      for (const r of results) {
        const { rows: taskInfo } = await client.query<{ step_name: string; process_name: string }>(
          `SELECT t.step_name, p.name AS process_name
           FROM tasks t
           JOIN process_instances pi ON pi.id = t.instance_id
           JOIN processes p ON p.id = pi.process_id
           WHERE t.id = $1`,
          [r.taskId]
        );
        const info = taskInfo[0];
        const recipient = await findUserById(client, r.newAssigneeId);
        if (recipient && info) {
          await notifyTaskAssigned(client, {
            recipientId: recipient.id,
            recipientEmail: recipient.email,
            recipientName: recipient.fullName,
            taskName: info.step_name,
            processName: info.process_name,
            isDelegated: r.isDelegated,
            originalAssigneeName: r.isDelegated ? target.fullName : undefined,
          });
        }

        await writeAuditLogTx(client, {
          userId: req.user!.id,
          action: 'TASK_REASSIGNED',
          entityType: 'task',
          entityId: r.taskId,
          details: { fromUserId: targetId, toUserId: r.newAssigneeId, isDelegated: r.isDelegated, reason: 'account_deactivated' },
          ipAddress: req.ip,
        });
      }

      await notifyAccountDeactivated(client, {
        userId: target.id,
        email: target.email,
        fullName: target.fullName,
        reassignedCount: results.length,
      });

      await writeAuditLogTx(client, {
        userId: req.user!.id,
        action: 'ACCOUNT_DEACTIVATED',
        entityType: 'user',
        entityId: targetId,
        details: { reassignedTaskCount: results.length },
        ipAddress: req.ip,
      });

      return results;
    });

    const updated = await findUserById(pool, targetId);
    res.json({ user: toPublicUser(updated!), reassignedTasks: reassignments.length });
  })
);

adminUsersRouter.post(
  '/:id/activate',
  asyncHandler(async (req, res) => {
    const targetId = req.params.id;
    const target = await findUserById(pool, targetId);
    if (!target) throw new HttpError(404, 'Utilisateur introuvable');
    if (target.isActive) throw new HttpError(409, 'Ce compte est déjà actif');

    await pool.query('UPDATE users SET is_active = TRUE WHERE id = $1', [targetId]);
    await writeAuditLog({
      userId: req.user!.id,
      action: 'ACCOUNT_REACTIVATED',
      entityType: 'user',
      entityId: targetId,
      ipAddress: req.ip,
    });

    const updated = await findUserById(pool, targetId);
    res.json({ user: toPublicUser(updated!) });
  })
);
