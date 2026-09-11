import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import multer from 'multer';
import { z } from 'zod';
import { pool, withTransaction } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { requirePageAccess } from '../middleware/pageAccess';
import { asyncHandler } from '../middleware/asyncHandler';
import { env } from '../config/env';
import { findUserById, listUsersPage, toPublicUser } from '../db/usersRepo';
import { writeAuditLog, writeAuditLogTx } from '../lib/audit';
import { HttpError } from '../middleware/errorHandler';
import { paginationQuerySchema } from '../lib/pagination';
import { parseCsvRecords } from '../lib/csv';
import { reassignPendingTasksForUser } from '../services/delegationService';
import { notifyAccountDeactivated, notifyPasswordChanged, notifyTaskAssigned, notifyWelcome } from '../services/notificationService';

export const adminUsersRouter = Router();
adminUsersRouter.use(requireAuth, requirePageAccess('USERS', 'VIEW'));

adminUsersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const pagination = paginationQuerySchema.parse(req.query);
    const { users, total, twoFactorEnabledCount } = await listUsersPage(pool, pagination);
    res.json({ users: users.map(toPublicUser), total, twoFactorEnabledCount });
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
  requirePageAccess('USERS', 'FULL'),
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
  requirePageAccess('USERS', 'FULL'),
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
  requirePageAccess('USERS', 'FULL'),
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
  requirePageAccess('USERS', 'FULL'),
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

const CSV_TEMPLATE = [
  'email,prenom,nom,telephone,motdepasse,roles',
  'jean.dupont@example.com,Jean,Dupont,+33612345678,MotDePasse123!,OPERATOR',
  'marie.martin@example.com,Marie,Martin,,,ADMIN;VALIDATOR',
].join('\r\n');

adminUsersRouter.get(
  '/import-template',
  requirePageAccess('USERS', 'FULL'),
  asyncHandler(async (_req, res) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="modele_import_utilisateurs.csv"');
    // BOM UTF-8 pour qu'Excel affiche correctement les accents.
    res.send(`﻿${CSV_TEMPLATE}`);
  })
);

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

interface ImportRowResult {
  row: number;
  email: string;
  action: 'created' | 'updated';
}
interface ImportRowError {
  row: number;
  email?: string;
  message: string;
}

adminUsersRouter.post(
  '/import',
  requirePageAccess('USERS', 'FULL'),
  csvUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Aucun fichier CSV fourni');

    const records = parseCsvRecords(req.file.buffer.toString('utf-8'));
    if (records.length === 0) throw new HttpError(400, 'Le fichier CSV est vide');

    const results: ImportRowResult[] = [];
    const errors: ImportRowError[] = [];

    for (let i = 0; i < records.length; i++) {
      const rowNum = i + 2; // +1 pour l'en-tête, +1 pour l'index 0-based
      const record = records[i];
      const email = (record.email || '').trim().toLowerCase();

      try {
        if (!email) throw new Error('Email manquant');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Email invalide');

        const firstName = (record.prenom || '').trim();
        const lastName = (record.nom || '').trim();
        const phone = (record.telephone || '').trim();
        const password = (record.motdepasse || '').trim();
        const roleNames = (record.roles || '')
          .split(';')
          .map((r) => r.trim().toUpperCase())
          .filter(Boolean);

        const action = await withTransaction(async (client) => {
          const { rows: existingRows } = await client.query<{ id: string }>(
            'SELECT id FROM users WHERE LOWER(email) = $1',
            [email]
          );
          const existingId = existingRows[0]?.id;

          let roleRows: { id: number }[] = [];
          if (roleNames.length > 0) {
            const { rows } = await client.query<{ id: number }>('SELECT id FROM roles WHERE name = ANY($1::text[])', [
              roleNames,
            ]);
            if (rows.length !== roleNames.length) {
              throw new Error(`Rôle(s) inconnu(s) : ${roleNames.join(', ')}`);
            }
            roleRows = rows;
          }

          if (existingId) {
            if (firstName || lastName) {
              const { rows: current } = await client.query<{ first_name: string | null; last_name: string | null }>(
                'SELECT first_name, last_name FROM users WHERE id = $1',
                [existingId]
              );
              const newFirst = firstName || current[0]?.first_name || '';
              const newLast = lastName || current[0]?.last_name || '';
              await client.query('UPDATE users SET first_name = $1, last_name = $2, full_name = $3 WHERE id = $4', [
                newFirst,
                newLast,
                `${newFirst} ${newLast}`.trim(),
                existingId,
              ]);
            }
            if (phone) {
              await client.query('UPDATE users SET phone = $1 WHERE id = $2', [phone, existingId]);
            }
            if (password) {
              if (password.length < 8) throw new Error('Le mot de passe doit contenir au moins 8 caractères');
              const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
              await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, existingId]);
            }
            if (roleNames.length > 0) {
              await client.query('DELETE FROM user_roles WHERE user_id = $1', [existingId]);
              for (const role of roleRows) {
                await client.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [existingId, role.id]);
              }
            }

            await writeAuditLogTx(client, {
              userId: req.user!.id,
              action: 'USER_UPDATED',
              entityType: 'user',
              entityId: existingId,
              details: { source: 'csv_import', email, roleNames: roleNames.length > 0 ? roleNames : undefined },
              ipAddress: req.ip,
            });

            return 'updated' as const;
          }

          if (!firstName || !lastName) throw new Error('Prénom et nom sont requis pour créer un compte');
          if (roleNames.length === 0) throw new Error('Au moins un rôle est requis pour créer un compte');

          const finalPassword = password || crypto.randomBytes(9).toString('base64');
          if (finalPassword.length < 8) throw new Error('Le mot de passe doit contenir au moins 8 caractères');
          const passwordHash = await bcrypt.hash(finalPassword, env.BCRYPT_ROUNDS);
          const fullName = `${firstName} ${lastName}`.trim();

          const { rows: userRows } = await client.query<{ id: string }>(
            `INSERT INTO users (email, password_hash, full_name, first_name, last_name, phone)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [email, passwordHash, fullName, firstName, lastName, phone || null]
          );
          const userId = userRows[0].id;

          for (const role of roleRows) {
            await client.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [userId, role.id]);
          }

          await writeAuditLogTx(client, {
            userId: req.user!.id,
            action: 'USER_CREATED',
            entityType: 'user',
            entityId: userId,
            details: { source: 'csv_import', email, roleNames },
            ipAddress: req.ip,
          });

          await notifyWelcome(client, { userId, email, fullName, temporaryPassword: finalPassword });

          return 'created' as const;
        });

        results.push({ row: rowNum, email, action });
      } catch (err) {
        errors.push({ row: rowNum, email: email || undefined, message: (err as Error).message });
      }
    }

    await writeAuditLog({
      userId: req.user!.id,
      action: 'USERS_BULK_IMPORTED',
      entityType: 'user',
      details: {
        totalRows: records.length,
        created: results.filter((r) => r.action === 'created').length,
        updated: results.filter((r) => r.action === 'updated').length,
        errorCount: errors.length,
      },
      ipAddress: req.ip,
    });

    res.json({
      created: results.filter((r) => r.action === 'created').length,
      updated: results.filter((r) => r.action === 'updated').length,
      results,
      errors,
    });
  })
);
