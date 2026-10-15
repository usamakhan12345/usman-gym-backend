import { z } from 'zod';

/** Strip formatting characters: "+92 300-1234567" -> "+923001234567". */
export const normalizePhone = (raw: string) => {
  const cleaned = raw.replace(/[\s\-().]/g, '');
  return cleaned.startsWith('00') ? `+${cleaned.slice(2)}` : cleaned;
};

export const normalizeEmail = (raw: string) => raw.trim().toLowerCase();

export const phoneSchema = z
  .string()
  .trim()
  .transform(normalizePhone)
  .refine((v) => /^\+?[0-9]{10,15}$/.test(v), 'Enter a valid phone number (10-15 digits)');

export const emailSchema = z.string().trim().email('Enter a valid email address').max(254).transform(normalizeEmail);

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
  .refine((v) => /[a-z]/i.test(v) && /\d/.test(v), 'Password must contain letters and numbers');

export const fullNameSchema = z.string().trim().min(2, 'Name is too short').max(100);

/** Login / reset identifier: an email or a phone number. */
export const identifierSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .transform((v) => (v.includes('@') ? normalizeEmail(v) : normalizePhone(v)));

export const identifierWhere = (identifier: string) =>
  identifier.includes('@') ? { email: identifier } : { phone: identifier };

export const moneySchema = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^\d{1,8}(\.\d{1,2})?$/.test(v), 'Enter a valid amount (max 2 decimals)');
