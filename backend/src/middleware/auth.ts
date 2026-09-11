import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { pool } from '../db/pool';
import { findUserById } from '../db/usersRepo';
import { logger } from '../lib/logger';

interface JwtPayload {
  sub: string;
  purpose?: string;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'Jeton d\'authentification manquant' });
    return;
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    // Un token émis en attente de vérification 2FA (purpose: 'pending_2fa')
    // ne doit jamais être accepté comme jeton d'accès complet : sans cette
    // vérification, connaître le mot de passe suffirait à contourner la 2FA.
    if (payload.purpose !== 'access') {
      res.status(401).json({ error: 'Jeton invalide' });
      return;
    }
    const user = await findUserById(pool, payload.sub);
    if (!user) {
      res.status(401).json({ error: 'Jeton invalide' });
      return;
    }
    if (!user.isActive) {
      res.status(403).json({ error: 'Compte désactivé' });
      return;
    }
    req.user = user;
    next();
  } catch (err) {
    logger.debug('JWT verification failed', { error: (err as Error).message });
    res.status(401).json({ error: 'Jeton invalide ou expiré' });
  }
}

export function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Non authentifié' });
      return;
    }
    const hasRole = req.user.roles.some((role) => allowedRoles.includes(role));
    if (!hasRole) {
      res.status(403).json({ error: 'Droits insuffisants pour cette action' });
      return;
    }
    next();
  };
}
