import fs from 'fs';
import path from 'path';
import winston from 'winston';
import { env } from '../config/env';

fs.mkdirSync(env.LOG_DIR, { recursive: true });

export const logger = winston.createLogger({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'bpm-backend' },
  transports: [
    new winston.transports.File({ filename: path.join(env.LOG_DIR, 'error.log'), level: 'error' }),
    new winston.transports.File({ filename: path.join(env.LOG_DIR, 'combined.log') }),
  ],
});

if (env.NODE_ENV !== 'production') {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
    })
  );
}
