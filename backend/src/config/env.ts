import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  CORS_ORIGIN: z.string().min(1),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  REFRESH_TOKEN_DAYS: z.coerce.number().min(1).max(90).default(30),
  PASSWORD_RESET_MINUTES: z.coerce.number().min(5).max(1440).default(60),
  TWO_FACTOR_PENDING_MINUTES: z.coerce.number().min(1).max(30).default(5),
  TWO_FACTOR_ISSUER: z.string().default('BPM Platform'),
  BCRYPT_ROUNDS: z.coerce.number().min(10).max(15).default(12),

  UPLOAD_DIR: z.string().default('/app/uploads'),
  LOG_DIR: z.string().default('/var/log/bpm'),
  MAX_UPLOAD_MB: z.coerce.number().default(20),

  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  SMTP_FROM: z.string().default('BPM Platform <no-reply@bpm.local>'),
  APP_BASE_URL: z.string().default('http://localhost:8080'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
