import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { findUserById, listUsers, toPublicUser } from '../db/usersRepo';
import { writeAuditLog } from '../lib/audit';
import { HttpError } from '../middleware/errorHandler';

export const usersRouter = Router();
usersRouter.use(requireAuth);

/** Liste minimale, utilisée par les sélecteurs (assignation, suppléants). */
usersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const users = await listUsers(pool);
    res.json({
      users: users.map((u) => ({ id: u.id, fullName: u.fullName, email: u.email, roles: u.roles, isActive: u.isActive })),
    });
  })
);

usersRouter.get(
  '/me/delegation',
  asyncHandler(async (req, res) => {
    const user = await findUserById(pool, req.user!.id);
    if (!user) throw new HttpError(404, 'Utilisateur introuvable');
    res.json({ delegation: toPublicUser(user) });
  })
);

const delegationSchema = z
  .object({
    delegateUser1Id: z.string().uuid().nullable().optional(),
    delegateUser2Id: z.string().uuid().nullable().optional(),
    absenceStart: z.string().nullable().optional(),
    absenceEnd: z.string().nullable().optional(),
  })
  .refine(
    (data) => !data.delegateUser1Id || !data.delegateUser2Id || data.delegateUser1Id !== data.delegateUser2Id,
    { message: 'Suppléant 1 et Suppléant 2 doivent être des utilisateurs différents' }
  )
  .refine(
    (data) => !data.absenceStart || !data.absenceEnd || data.absenceEnd >= data.absenceStart,
    { message: 'La date de fin de congé doit être postérieure à la date de début' }
  );

usersRouter.put(
  '/me/delegation',
  asyncHandler(async (req, res) => {
    const body = delegationSchema.parse(req.body);
    const userId = req.user!.id;

    if (body.delegateUser1Id === userId || body.delegateUser2Id === userId) {
      throw new HttpError(400, 'Vous ne pouvez pas être votre propre suppléant');
    }

    await pool.query(
      `UPDATE users
       SET delegate_user_1_id = $1, delegate_user_2_id = $2, absence_start = $3, absence_end = $4
       WHERE id = $5`,
      [
        body.delegateUser1Id ?? null,
        body.delegateUser2Id ?? null,
        body.absenceStart ?? null,
        body.absenceEnd ?? null,
        userId,
      ]
    );

    await writeAuditLog({
      userId,
      action: 'DELEGATION_UPDATED',
      entityType: 'user',
      entityId: userId,
      details: body,
      ipAddress: req.ip,
    });

    const updated = await findUserById(pool, userId);
    res.json({ delegation: toPublicUser(updated!) });
  })
);
