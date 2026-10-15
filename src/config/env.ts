import path from 'path';
import dotenv from 'dotenv';
import { z } from 'zod';

const isTestRun = process.env.NODE_ENV === 'test';
// In tests, .env.test must win over anything already loaded (e.g. by Prisma) so tests never touch the dev database.
dotenv.config({ path: path.resolve(process.cwd(), isTestRun ? '.env.test' : '.env'), override: isTestRun });

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  FRONTEND_URL: z.string().default('http://localhost:3000'),
  APP_URL: z.string().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  SESSION_DAYS: z.coerce.number().int().positive().default(7),
  COOKIE_SECURE: bool,

  APP_TIMEZONE: z.string().default('Asia/Karachi'),
  GYM_ID_PREFIX: z.string().default('UG'),
  BILLING_LATE_JOIN_POLICY: z.enum(['FULL_MONTH', 'NEXT_MONTH']).default('FULL_MONTH'),
  OVERDUE_GRACE_DAYS: z.coerce.number().int().min(0).default(10),
  ENABLE_BILLING_CRON: bool,

  OTP_PROVIDER: z.enum(['console', 'smtp', 'twilio', 'memory']).default('console'),
  /** DEV ONLY: fixed OTP for the console provider (e.g. 123456). Ignored/refused otherwise. */
  OTP_DEV_CODE: z.string().regex(/^\d{6}$/, 'OTP_DEV_CODE must be 6 digits').optional().or(z.literal('').transform(() => undefined)),
  OTP_TTL_MINUTES: z.coerce.number().int().positive().default(10),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('Usman Gym <no-reply@example.com>'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM: z.string().optional(),

  UPLOAD_DIR: z.string().default('uploads'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(2),
  MAX_PROOF_UPLOAD_MB: z.coerce.number().positive().default(5),

  ADMIN_FULL_NAME: z.string().default('Gym Admin'),
  ADMIN_EMAIL: z.string().optional(),
  ADMIN_PHONE: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

if (isProd && (env.OTP_PROVIDER === 'console' || env.OTP_PROVIDER === 'memory')) {
  console.error('OTP_PROVIDER=console/memory is development-only and cannot be used in production.');
  process.exit(1);
}
if (env.OTP_DEV_CODE && (isProd || env.OTP_PROVIDER !== 'console')) {
  console.error('OTP_DEV_CODE is only allowed with OTP_PROVIDER=console outside production.');
  process.exit(1);
}
if (isProd && !env.COOKIE_SECURE) {
  console.warn('WARNING: COOKIE_SECURE is false in production. Set COOKIE_SECURE=true when serving over HTTPS.');
}

export const uploadRoot = path.resolve(process.cwd(), env.UPLOAD_DIR);
