import { NextFunction, Request, Response } from 'express';
import { MulterError } from 'multer';
import { ZodError } from 'zod';
import { logger } from '../lib/logger';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: 'Ressource introuvable' });
}

/**
 * Erreurs provoquées par la requête elle-même (et non par un défaut du
 * serveur) remontées par les bibliothèques : elles doivent produire une 4xx
 * explicite plutôt qu'une 500 journalisée comme incident.
 */
function toClientError(err: unknown): { status: number; message: string } | null {
  if (err instanceof MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return { status: 413, message: 'Fichier trop volumineux' };
    return { status: 400, message: `Envoi de fichier invalide (${err.code})` };
  }
  const e = err as { code?: unknown; type?: unknown };
  // PostgreSQL "invalid_text_representation" : ex. "abc" passé comme identifiant uuid.
  if (e?.code === '22P02') return { status: 400, message: 'Identifiant ou valeur invalide' };
  // body-parser : JSON mal formé ou corps trop volumineux.
  if (e?.type === 'entity.parse.failed') return { status: 400, message: 'Corps de requête JSON invalide' };
  if (e?.type === 'entity.too.large') return { status: 413, message: 'Corps de requête trop volumineux' };
  return null;
}

export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Requête invalide', details: err.flatten().fieldErrors });
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }

  const clientError = toClientError(err);
  if (clientError) {
    res.status(clientError.status).json({ error: clientError.message });
    return;
  }

  const message = err instanceof Error ? err.message : 'Erreur inconnue';
  logger.error('Unhandled request error', {
    error: message,
    stack: err instanceof Error ? err.stack : undefined,
    path: req.path,
    method: req.method,
  });
  res.status(500).json({ error: 'Erreur interne du serveur' });
}
