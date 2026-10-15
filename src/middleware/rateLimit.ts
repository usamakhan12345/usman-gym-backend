import { Request } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { isTest } from '../config/env';

const make = (windowMinutes: number, max: number, message: string, keyBody?: string) =>
  rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => isTest,
    // Limit per IP, and per target account when the body names one, to slow credential/OTP stuffing.
    keyGenerator: (req: Request) => {
      const target = keyBody ? String(req.body?.[keyBody] ?? '').toLowerCase().slice(0, 100) : '';
      // ipKeyGenerator groups IPv6 addresses by /64 so rotating addresses inside one block cannot bypass the limit
      return `${ipKeyGenerator(req.ip ?? '')}|${target}`;
    },
    message: { success: false, error: { code: 'RATE_LIMITED', message } },
  });

export const loginLimiter = make(15, 10, 'Too many login attempts. Try again in a few minutes.', 'identifier');
export const otpVerifyLimiter = make(15, 15, 'Too many verification attempts. Try again later.', 'identifier');
export const otpSendLimiter = make(15, 5, 'Too many code requests. Try again later.', 'identifier');
export const registerLimiter = make(60, 10, 'Too many sign-up attempts. Try again later.');
export const contactLimiter = make(60, 5, 'Too many messages. Please try again later.');
