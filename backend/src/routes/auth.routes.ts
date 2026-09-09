import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../config/env';
import { pool } from '../db/pool';
import { findUserByEmail, toPublicUser } from '../db/usersRepo';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { writeAuditLog } from '../lib/audit';
import { logger } from '../lib/logger';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives de connexion, réessayez plus tard.' },
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);

    const record = await findUserByEmail(pool, email);
    if (!record) {
      res.status(401).json({ error: 'Identifiants invalides' });
      return;
    }

    const passwordOk = await bcrypt.compare(password, record.password_hash);
    if (!passwordOk) {
      await writeAuditLog({
        userId: record.id,
        action: 'LOGIN_FAILED',
        entityType: 'user',
        entityId: record.id,
        ipAddress: req.ip,
      });
      res.status(401).json({ error: 'Identifiants invalides' });
      return;
    }

    if (!record.is_active) {
      res.status(403).json({ error: 'Ce compte a été désactivé' });
      return;
    }

    const token = jwt.sign({ sub: record.id }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN } as jwt.SignOptions);

    await writeAuditLog({
      userId: record.id,
      action: 'LOGIN_SUCCESS',
      entityType: 'user',
      entityId: record.id,
      ipAddress: req.ip,
    });

    logger.info('User logged in', { userId: record.id, email: record.email });
    res.json({ token, user: toPublicUser(record.authUser) });
  })
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: toPublicUser(req.user!) });
  })
);

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'Le nouveau mot de passe doit contenir au moins 8 caractères'),
});

authRouter.put(
  '/me/password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    const record = await findUserByEmail(pool, req.user!.email);
    if (!record) {
      res.status(404).json({ error: 'Utilisateur introuvable' });
      return;
    }

    const ok = await bcrypt.compare(currentPassword, record.password_hash);
    if (!ok) {
      res.status(400).json({ error: 'Mot de passe actuel incorrect' });
      return;
    }

    const newHash = await bcrypt.hash(newPassword, env.BCRYPT_ROUNDS);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, req.user!.id]);

    await writeAuditLog({
      userId: req.user!.id,
      action: 'PASSWORD_CHANGED',
      entityType: 'user',
      entityId: req.user!.id,
      ipAddress: req.ip,
    });

    res.json({ ok: true });
  })
);
