import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';
import { env } from './config/env';
import { logger } from './lib/logger';
import { pool } from './db/pool';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { authRouter } from './routes/auth.routes';
import { usersRouter } from './routes/users.routes';
import { adminUsersRouter } from './routes/admin.routes';
import { rolesRouter } from './routes/roles.routes';
import { processesRouter } from './routes/processes.routes';
import { instancesRouter } from './routes/instances.routes';
import { tasksRouter } from './routes/tasks.routes';
import { documentsRouter } from './routes/documents.routes';
import { notificationsRouter } from './routes/notifications.routes';
import { auditRouter } from './routes/audit.routes';
import { clientsRouter } from './routes/clients.routes';
import { adminMetaRouter } from './routes/adminMeta.routes';

const app = express();

app.set('trust proxy', 1);
app.use(helmet());
app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));

app.use((req, _res, next) => {
  logger.debug('HTTP request', { method: req.method, path: req.path });
  next();
});

app.get('/api/health', (_req, res) => res.json({ ok: true, timestamp: new Date().toISOString() }));

app.use('/uploads/avatars', express.static(path.join(env.UPLOAD_DIR, 'avatars')));

app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/admin/users', adminUsersRouter);
app.use('/api/roles', rolesRouter);
app.use('/api/processes', processesRouter);
app.use('/api/instances', instancesRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/audit', auditRouter);
app.use('/api/clients', clientsRouter);
app.use('/api/admin', adminMetaRouter);

app.use(notFoundHandler);
app.use(errorHandler);

async function waitForDatabase(retries = 20, delayMs = 1500): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await pool.query('SELECT 1');
      logger.info('Database connection established');
      return;
    } catch (err) {
      logger.warn(`Database not ready (attempt ${attempt}/${retries})`, { error: (err as Error).message });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error('Unable to reach the database after multiple attempts');
}

async function main(): Promise<void> {
  await waitForDatabase();
  const server = app.listen(env.PORT, () => {
    logger.info(`BPM backend listening on :${env.PORT}`);
  });

  const shutdown = (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully`);
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error('Fatal startup error', { error: (err as Error).message });
  process.exit(1);
});
