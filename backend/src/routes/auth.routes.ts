import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../config/env';
import { pool } from '../db/pool';
import { findUserByEmail, findUserById, toPublicUser } from '../db/usersRepo';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { HttpError } from '../middleware/errorHandler';
import { writeAuditLog } from '../lib/audit';
import { logger } from '../lib/logger';
import { generateOpaqueToken, hashOpaqueToken } from '../lib/tokens';
import { generateBackupCodes, generateTotpQrCode, generateTotpSecret, verifyBackupCode, verifyTotpCode } from '../lib/twoFactor';
import { notifyPasswordChanged, notifyPasswordResetRequested } from '../services/notificationService';
import { getAllEffectiveLevels } from '../middleware/pageAccess';
import { AuthenticatedUser, PAGE_KEYS } from '../types';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives de connexion, réessayez plus tard.' },
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de demandes, réessayez plus tard.' },
});

const twoFactorLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives, réessayez plus tard.' },
});

/** Émet un nouveau couple token d'accès (court, réutilisé en Bearer) / refresh token (opaque, stocké hashé, longue durée). */
async function issueSession(userId: string): Promise<{ token: string; refreshToken: string }> {
  const token = jwt.sign({ sub: userId, purpose: 'access' }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  } as jwt.SignOptions);

  const { raw, hash } = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);
  await pool.query('INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)', [
    userId,
    hash,
    expiresAt,
  ]);

  return { token, refreshToken: raw };
}

async function buildLoginResponse(user: AuthenticatedUser) {
  const { token, refreshToken } = await issueSession(user.id);
  const pageAccess = await getAllEffectiveLevels(user.roles, user.roleIds, PAGE_KEYS);
  return { token, refreshToken, user: toPublicUser(user), pageAccess };
}

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

    if (record.two_factor_enabled) {
      const pendingToken = jwt.sign({ sub: record.id, purpose: 'pending_2fa' }, env.JWT_SECRET, {
        expiresIn: `${env.TWO_FACTOR_PENDING_MINUTES}m`,
      } as jwt.SignOptions);
      res.json({ requiresTwoFactor: true, pendingToken });
      return;
    }

    await writeAuditLog({
      userId: record.id,
      action: 'LOGIN_SUCCESS',
      entityType: 'user',
      entityId: record.id,
      ipAddress: req.ip,
    });

    logger.info('User logged in', { userId: record.id, email: record.email });
    res.json(await buildLoginResponse(record.authUser));
  })
);

interface PendingTwoFactorPayload {
  sub: string;
  purpose: string;
}

const twoFactorVerifyLoginSchema = z.object({
  pendingToken: z.string().min(1),
  code: z.string().min(1),
});

authRouter.post(
  '/2fa/verify-login',
  twoFactorLimiter,
  asyncHandler(async (req, res) => {
    const { pendingToken, code } = twoFactorVerifyLoginSchema.parse(req.body);

    let payload: PendingTwoFactorPayload;
    try {
      payload = jwt.verify(pendingToken, env.JWT_SECRET) as PendingTwoFactorPayload;
    } catch {
      res.status(401).json({ error: 'Session de connexion expirée, recommencez.' });
      return;
    }
    if (payload.purpose !== 'pending_2fa') {
      res.status(401).json({ error: 'Jeton invalide' });
      return;
    }

    const user = await findUserById(pool, payload.sub);
    if (!user || !user.isActive || !user.twoFactorEnabled) {
      res.status(401).json({ error: 'Session de connexion expirée, recommencez.' });
      return;
    }

    const { rows } = await pool.query<{ two_factor_secret: string | null }>(
      'SELECT two_factor_secret FROM users WHERE id = $1',
      [user.id]
    );
    const secret = rows[0]?.two_factor_secret;
    if (!secret) {
      res.status(401).json({ error: 'Session de connexion expirée, recommencez.' });
      return;
    }

    let ok = await verifyTotpCode(secret, code);
    if (!ok) {
      const { rows: backupRows } = await pool.query<{ id: string; code_hash: string }>(
        'SELECT id, code_hash FROM two_factor_backup_codes WHERE user_id = $1 AND used_at IS NULL',
        [user.id]
      );
      for (const backup of backupRows) {
        if (await verifyBackupCode(code, backup.code_hash)) {
          await pool.query('UPDATE two_factor_backup_codes SET used_at = now() WHERE id = $1', [backup.id]);
          ok = true;
          break;
        }
      }
    }

    if (!ok) {
      await writeAuditLog({
        userId: user.id,
        action: 'LOGIN_FAILED',
        entityType: 'user',
        entityId: user.id,
        details: { reason: 'invalid_2fa_code' },
        ipAddress: req.ip,
      });
      res.status(401).json({ error: 'Code invalide' });
      return;
    }

    await writeAuditLog({
      userId: user.id,
      action: 'LOGIN_SUCCESS',
      entityType: 'user',
      entityId: user.id,
      details: { via: '2fa' },
      ipAddress: req.ip,
    });

    logger.info('User logged in via 2FA', { userId: user.id });
    res.json(await buildLoginResponse(user));
  })
);

const refreshSchema = z.object({ refreshToken: z.string().min(1) });

authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const { refreshToken } = refreshSchema.parse(req.body);
    const hash = hashOpaqueToken(refreshToken);

    const { rows } = await pool.query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM refresh_tokens
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [hash]
    );
    const existing = rows[0];
    if (!existing) {
      res.status(401).json({ error: 'Session expirée, veuillez vous reconnecter.' });
      return;
    }

    const user = await findUserById(pool, existing.user_id);
    if (!user || !user.isActive) {
      res.status(401).json({ error: 'Session expirée, veuillez vous reconnecter.' });
      return;
    }

    // Rotation : l'ancien refresh token est révoqué et remplacé, ce qui
    // permettrait de détecter une réutilisation frauduleuse le cas échéant.
    const next = await issueSession(user.id);
    const { rows: newRows } = await pool.query<{ id: string }>('SELECT id FROM refresh_tokens WHERE token_hash = $1', [
      hashOpaqueToken(next.refreshToken),
    ]);
    await pool.query('UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $1 WHERE id = $2', [
      newRows[0]?.id ?? null,
      existing.id,
    ]);

    res.json({ token: next.token, refreshToken: next.refreshToken });
  })
);

const logoutSchema = z.object({ refreshToken: z.string().min(1).optional() });

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const { refreshToken } = logoutSchema.parse(req.body ?? {});
    if (refreshToken) {
      await pool.query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [
        hashOpaqueToken(refreshToken),
      ]);
    }
    res.json({ ok: true });
  })
);

const forgotPasswordSchema = z.object({ email: z.string().email() });

authRouter.post(
  '/forgot-password',
  forgotPasswordLimiter,
  asyncHandler(async (req, res) => {
    const { email } = forgotPasswordSchema.parse(req.body);
    const record = await findUserByEmail(pool, email);

    // Réponse identique que le compte existe ou non, pour ne pas permettre
    // à un tiers de découvrir quels emails sont enregistrés.
    if (record && record.is_active) {
      const { raw, hash } = generateOpaqueToken();
      const expiresAt = new Date(Date.now() + env.PASSWORD_RESET_MINUTES * 60 * 1000);
      await pool.query('INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)', [
        record.id,
        hash,
        expiresAt,
      ]);

      await notifyPasswordResetRequested(pool, {
        userId: record.id,
        email: record.email,
        fullName: record.full_name,
        resetUrl: `${env.APP_BASE_URL}/reset-password?token=${raw}`,
        expiresInMinutes: env.PASSWORD_RESET_MINUTES,
      });

      await writeAuditLog({
        userId: record.id,
        action: 'PASSWORD_RESET_REQUESTED',
        entityType: 'user',
        entityId: record.id,
        ipAddress: req.ip,
      });
    }

    res.json({ ok: true });
  })
);

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8, 'Le nouveau mot de passe doit contenir au moins 8 caractères'),
});

authRouter.post(
  '/reset-password',
  forgotPasswordLimiter,
  asyncHandler(async (req, res) => {
    const { token, newPassword } = resetPasswordSchema.parse(req.body);
    const hash = hashOpaqueToken(token);

    const { rows } = await pool.query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM password_reset_tokens
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
      [hash]
    );
    const record = rows[0];
    if (!record) {
      throw new HttpError(400, 'Ce lien de réinitialisation est invalide ou a expiré');
    }

    const user = await findUserById(pool, record.user_id);
    if (!user || !user.isActive) {
      throw new HttpError(400, 'Ce lien de réinitialisation est invalide ou a expiré');
    }

    const newHash = await bcrypt.hash(newPassword, env.BCRYPT_ROUNDS);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, user.id]);
    await pool.query('UPDATE password_reset_tokens SET used_at = now() WHERE id = $1', [record.id]);
    // Toute session existante (refresh tokens) est invalidée : un mot de
    // passe compromis ne doit pas laisser une session active ailleurs.
    await pool.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [
      user.id,
    ]);

    await writeAuditLog({
      userId: user.id,
      action: 'PASSWORD_RESET_COMPLETED',
      entityType: 'user',
      entityId: user.id,
      ipAddress: req.ip,
    });

    await notifyPasswordChanged(pool, {
      userId: user.id,
      email: user.email,
      fullName: user.fullName,
      changedByAdmin: false,
    });

    res.json({ ok: true });
  })
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const pageAccess = await getAllEffectiveLevels(req.user!.roles, req.user!.roleIds, PAGE_KEYS);
    res.json({ user: toPublicUser(req.user!), pageAccess });
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

    await notifyPasswordChanged(pool, {
      userId: req.user!.id,
      email: req.user!.email,
      fullName: req.user!.fullName,
      changedByAdmin: false,
    });

    res.json({ ok: true });
  })
);

authRouter.get(
  '/2fa/setup',
  requireAuth,
  asyncHandler(async (req, res) => {
    const secret = generateTotpSecret();
    await pool.query('UPDATE users SET two_factor_secret = $1 WHERE id = $2', [secret, req.user!.id]);
    const qrCodeDataUrl = await generateTotpQrCode(secret, req.user!.email);
    res.json({ secret, qrCodeDataUrl });
  })
);

const twoFactorEnableSchema = z.object({ code: z.string().min(1) });

authRouter.post(
  '/2fa/enable',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { code } = twoFactorEnableSchema.parse(req.body);

    const { rows } = await pool.query<{ two_factor_secret: string | null }>(
      'SELECT two_factor_secret FROM users WHERE id = $1',
      [req.user!.id]
    );
    const secret = rows[0]?.two_factor_secret;
    if (!secret) {
      throw new HttpError(400, "Démarrez d'abord la configuration (QR code) avant de saisir un code");
    }

    const ok = await verifyTotpCode(secret, code);
    if (!ok) throw new HttpError(400, 'Code invalide');

    const { plain, hashes } = await generateBackupCodes();
    await pool.query('DELETE FROM two_factor_backup_codes WHERE user_id = $1', [req.user!.id]);
    for (const hash of hashes) {
      await pool.query('INSERT INTO two_factor_backup_codes (user_id, code_hash) VALUES ($1, $2)', [req.user!.id, hash]);
    }

    await pool.query('UPDATE users SET two_factor_enabled = TRUE, two_factor_enabled_at = now() WHERE id = $1', [
      req.user!.id,
    ]);

    await writeAuditLog({
      userId: req.user!.id,
      action: 'TWO_FACTOR_ENABLED',
      entityType: 'user',
      entityId: req.user!.id,
      ipAddress: req.ip,
    });

    res.json({ ok: true, backupCodes: plain });
  })
);

const twoFactorDisableSchema = z.object({ password: z.string().min(1) });

authRouter.post(
  '/2fa/disable',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { password } = twoFactorDisableSchema.parse(req.body);
    const record = await findUserByEmail(pool, req.user!.email);
    if (!record) {
      res.status(404).json({ error: 'Utilisateur introuvable' });
      return;
    }

    const ok = await bcrypt.compare(password, record.password_hash);
    if (!ok) throw new HttpError(400, 'Mot de passe incorrect');

    await pool.query(
      `UPDATE users SET two_factor_enabled = FALSE, two_factor_secret = NULL, two_factor_enabled_at = NULL
       WHERE id = $1`,
      [req.user!.id]
    );
    await pool.query('DELETE FROM two_factor_backup_codes WHERE user_id = $1', [req.user!.id]);

    await writeAuditLog({
      userId: req.user!.id,
      action: 'TWO_FACTOR_DISABLED',
      entityType: 'user',
      entityId: req.user!.id,
      ipAddress: req.ip,
    });

    res.json({ ok: true });
  })
);
