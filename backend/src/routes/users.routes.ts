import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import { z } from 'zod';
import { pool } from '../db/pool';
import { env } from '../config/env';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { findUserById, listUsers, toPublicUser } from '../db/usersRepo';
import { writeAuditLog } from '../lib/audit';
import { HttpError } from '../middleware/errorHandler';

export const usersRouter = Router();
usersRouter.use(requireAuth);

const AVATAR_DIR = path.join(env.UPLOAD_DIR, 'avatars');
fs.mkdirSync(AVATAR_DIR, { recursive: true });

const AVATAR_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: AVATAR_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).slice(0, 10) || '.jpg';
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!AVATAR_MIME_TYPES.has(file.mimetype)) {
      cb(new HttpError(400, `Type d'image non autorisé : ${file.mimetype}`) as unknown as Error);
      return;
    }
    cb(null, true);
  },
});

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

const profileSchema = z.object({
  firstName: z.string().trim().min(1, 'Le prénom est requis').max(255),
  lastName: z.string().trim().min(1, 'Le nom est requis').max(255),
  phone: z.string().trim().max(50).nullable().optional(),
  email: z.string().email(),
  emailNotificationsEnabled: z.boolean().optional(),
});

usersRouter.put(
  '/me',
  asyncHandler(async (req, res) => {
    const body = profileSchema.parse(req.body);
    const userId = req.user!.id;
    const fullName = `${body.firstName} ${body.lastName}`.trim();

    const { rows: existing } = await pool.query('SELECT id FROM users WHERE email = $1 AND id <> $2', [
      body.email,
      userId,
    ]);
    if (existing.length > 0) throw new HttpError(409, 'Cette adresse email est déjà utilisée par un autre compte');

    await pool.query(
      `UPDATE users SET first_name = $1, last_name = $2, full_name = $3, phone = $4, email = $5 WHERE id = $6`,
      [body.firstName, body.lastName, fullName, body.phone || null, body.email, userId]
    );

    if (body.emailNotificationsEnabled !== undefined) {
      await pool.query('UPDATE users SET email_notifications_enabled = $1 WHERE id = $2', [
        body.emailNotificationsEnabled,
        userId,
      ]);
    }

    await writeAuditLog({
      userId,
      action: 'PROFILE_UPDATED',
      entityType: 'user',
      entityId: userId,
      details: { firstName: body.firstName, lastName: body.lastName, phone: body.phone ?? null, email: body.email },
      ipAddress: req.ip,
    });

    const updated = await findUserById(pool, userId);
    res.json({ user: toPublicUser(updated!) });
  })
);

usersRouter.post(
  '/me/avatar',
  avatarUpload.single('avatar'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Aucune image fournie (champ "avatar" attendu)');
    const userId = req.user!.id;

    const previous = await findUserById(pool, userId);
    const avatarUrl = `/uploads/avatars/${req.file.filename}`;
    await pool.query('UPDATE users SET avatar_url = $1 WHERE id = $2', [avatarUrl, userId]);

    if (previous?.avatarUrl) {
      const oldPath = path.join(AVATAR_DIR, path.basename(previous.avatarUrl));
      fs.unlink(oldPath, () => undefined);
    }

    await writeAuditLog({
      userId,
      action: 'AVATAR_UPDATED',
      entityType: 'user',
      entityId: userId,
      ipAddress: req.ip,
    });

    const updated = await findUserById(pool, userId);
    res.json({ user: toPublicUser(updated!) });
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
