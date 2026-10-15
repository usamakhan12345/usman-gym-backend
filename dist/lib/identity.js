"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.moneySchema = exports.identifierWhere = exports.identifierSchema = exports.fullNameSchema = exports.passwordSchema = exports.emailSchema = exports.phoneSchema = exports.normalizeEmail = exports.normalizePhone = void 0;
const zod_1 = require("zod");
/** Strip formatting characters: "+92 300-1234567" -> "+923001234567". */
const normalizePhone = (raw) => {
    const cleaned = raw.replace(/[\s\-().]/g, '');
    return cleaned.startsWith('00') ? `+${cleaned.slice(2)}` : cleaned;
};
exports.normalizePhone = normalizePhone;
const normalizeEmail = (raw) => raw.trim().toLowerCase();
exports.normalizeEmail = normalizeEmail;
exports.phoneSchema = zod_1.z
    .string()
    .trim()
    .transform(exports.normalizePhone)
    .refine((v) => /^\+?[0-9]{10,15}$/.test(v), 'Enter a valid phone number (10-15 digits)');
exports.emailSchema = zod_1.z.string().trim().email('Enter a valid email address').max(254).transform(exports.normalizeEmail);
exports.passwordSchema = zod_1.z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(72, 'Password must be at most 72 characters')
    .refine((v) => /[a-z]/i.test(v) && /\d/.test(v), 'Password must contain letters and numbers');
exports.fullNameSchema = zod_1.z.string().trim().min(2, 'Name is too short').max(100);
/** Login / reset identifier: an email or a phone number. */
exports.identifierSchema = zod_1.z
    .string()
    .trim()
    .min(3)
    .max(254)
    .transform((v) => (v.includes('@') ? (0, exports.normalizeEmail)(v) : (0, exports.normalizePhone)(v)));
const identifierWhere = (identifier) => identifier.includes('@') ? { email: identifier } : { phone: identifier };
exports.identifierWhere = identifierWhere;
exports.moneySchema = zod_1.z
    .union([zod_1.z.string(), zod_1.z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => /^\d{1,8}(\.\d{1,2})?$/.test(v), 'Enter a valid amount (max 2 decimals)');
