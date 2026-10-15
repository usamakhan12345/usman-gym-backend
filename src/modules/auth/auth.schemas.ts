import { z } from 'zod';
import { emailSchema, fullNameSchema, identifierSchema, passwordSchema, phoneSchema } from '../../lib/identity';

const otpCode = z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code');

export const registerSchema = z
  .object({ fullName: fullNameSchema, email: emailSchema, phone: phoneSchema, password: passwordSchema })
  .strict();

export const loginSchema = z.object({ identifier: identifierSchema, password: z.string().min(1).max(200) }).strict();

export const verifyOtpSchema = z
  .object({ identifier: identifierSchema, purpose: z.enum(['SIGNUP', 'PASSWORD_RESET']), code: otpCode })
  .strict();

export const resendOtpSchema = z
  .object({ identifier: identifierSchema, purpose: z.enum(['SIGNUP', 'PASSWORD_RESET']) })
  .strict();

export const forgotPasswordSchema = z.object({ identifier: identifierSchema }).strict();

export const resetPasswordSchema = z
  .object({ resetToken: z.string().length(64), newPassword: passwordSchema })
  .strict();

export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1).max(200), newPassword: passwordSchema })
  .strict();
