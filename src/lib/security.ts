import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env, isTest } from '../config/env';

const BCRYPT_ROUNDS = isTest ? 4 : 12; // low cost only to keep the test suite fast

export const hashPassword = (plain: string) => bcrypt.hash(plain, BCRYPT_ROUNDS);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

// Used to keep login timing similar when the account does not exist.
export const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS);

/** Keyed hash for OTPs / reset tokens so a DB leak does not reveal usable codes. */
export const hmac = (value: string) => crypto.createHmac('sha256', env.JWT_SECRET).update(value).digest('hex');

export const safeEqual = (a: string, b: string) => {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};

export const generateOtp = () => crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
export const generateToken = () => crypto.randomBytes(32).toString('hex');

export interface SessionPayload {
  sub: string;
  role: 'ADMIN' | 'MEMBER';
  tv: number;
}

export const signSession = (payload: SessionPayload) =>
  jwt.sign(payload, env.JWT_SECRET, { expiresIn: `${env.SESSION_DAYS}d` });

export const verifySession = (token: string): SessionPayload | null => {
  try {
    return jwt.verify(token, env.JWT_SECRET) as SessionPayload;
  } catch {
    return null;
  }
};

export const COOKIE_NAME = 'ug_session';
export const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: env.COOKIE_SECURE,
  path: '/',
  maxAge: env.SESSION_DAYS * 24 * 60 * 60 * 1000,
});
