"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadRoot = exports.isTest = exports.isProd = exports.env = void 0;
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
const zod_1 = require("zod");
const isTestRun = process.env.NODE_ENV === 'test';
// In tests, .env.test must win over anything already loaded (e.g. by Prisma) so tests never touch the dev database.
dotenv_1.default.config({ path: path_1.default.resolve(process.cwd(), isTestRun ? '.env.test' : '.env'), override: isTestRun });
const bool = zod_1.z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true');
const schema = zod_1.z.object({
    NODE_ENV: zod_1.z.enum(['development', 'test', 'production']).default('development'),
    PORT: zod_1.z.coerce.number().default(4000),
    FRONTEND_URL: zod_1.z.string().default('http://localhost:3000'),
    APP_URL: zod_1.z.string().default('http://localhost:3000'),
    DATABASE_URL: zod_1.z.string().min(1),
    JWT_SECRET: zod_1.z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    SESSION_DAYS: zod_1.z.coerce.number().int().positive().default(7),
    COOKIE_SECURE: bool,
    APP_TIMEZONE: zod_1.z.string().default('Asia/Karachi'),
    GYM_ID_PREFIX: zod_1.z.string().default('UG'),
    BILLING_LATE_JOIN_POLICY: zod_1.z.enum(['FULL_MONTH', 'NEXT_MONTH']).default('FULL_MONTH'),
    OVERDUE_GRACE_DAYS: zod_1.z.coerce.number().int().min(0).default(10),
    ENABLE_BILLING_CRON: bool,
    OTP_PROVIDER: zod_1.z.enum(['console', 'smtp', 'twilio', 'memory']).default('console'),
    /** DEV ONLY: fixed OTP for the console provider (e.g. 123456). Ignored/refused otherwise. */
    OTP_DEV_CODE: zod_1.z.string().regex(/^\d{6}$/, 'OTP_DEV_CODE must be 6 digits').optional().or(zod_1.z.literal('').transform(() => undefined)),
    OTP_TTL_MINUTES: zod_1.z.coerce.number().int().positive().default(10),
    SMTP_HOST: zod_1.z.string().optional(),
    SMTP_PORT: zod_1.z.coerce.number().default(587),
    SMTP_USER: zod_1.z.string().optional(),
    SMTP_PASS: zod_1.z.string().optional(),
    SMTP_FROM: zod_1.z.string().default('Usman Gym <no-reply@example.com>'),
    TWILIO_ACCOUNT_SID: zod_1.z.string().optional(),
    TWILIO_AUTH_TOKEN: zod_1.z.string().optional(),
    TWILIO_FROM: zod_1.z.string().optional(),
    UPLOAD_DIR: zod_1.z.string().default('uploads'),
    MAX_UPLOAD_MB: zod_1.z.coerce.number().positive().default(2),
    MAX_PROOF_UPLOAD_MB: zod_1.z.coerce.number().positive().default(5),
    ADMIN_FULL_NAME: zod_1.z.string().default('Gym Admin'),
    ADMIN_EMAIL: zod_1.z.string().optional(),
    ADMIN_PHONE: zod_1.z.string().optional(),
    ADMIN_PASSWORD: zod_1.z.string().optional(),
});
const parsed = schema.safeParse(process.env);
if (!parsed.success) {
    console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
    process.exit(1);
}
exports.env = parsed.data;
exports.isProd = exports.env.NODE_ENV === 'production';
exports.isTest = exports.env.NODE_ENV === 'test';
if (exports.isProd && (exports.env.OTP_PROVIDER === 'console' || exports.env.OTP_PROVIDER === 'memory')) {
    console.error('OTP_PROVIDER=console/memory is development-only and cannot be used in production.');
    process.exit(1);
}
if (exports.env.OTP_DEV_CODE && (exports.isProd || exports.env.OTP_PROVIDER !== 'console')) {
    console.error('OTP_DEV_CODE is only allowed with OTP_PROVIDER=console outside production.');
    process.exit(1);
}
if (exports.isProd && !exports.env.COOKIE_SECURE) {
    console.warn('WARNING: COOKIE_SECURE is false in production. Set COOKIE_SECURE=true when serving over HTTPS.');
}
exports.uploadRoot = path_1.default.resolve(process.cwd(), exports.env.UPLOAD_DIR);
