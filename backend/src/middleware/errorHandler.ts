import { NextFunction, Request, Response } from 'express';
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

export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Requête invalide', details: err.flatten().fieldErrors });
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
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
