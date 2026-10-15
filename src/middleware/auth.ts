import { NextFunction, Request, Response } from 'express';
import { Role, User } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { forbidden, unauthorized } from '../lib/errors';
import { COOKIE_NAME, verifySession } from '../lib/security';

declare module 'express-serve-static-core' {
  interface Request {
    user?: User;
  }
}

/** Loads the session user from the DB on every request (role/status/tokenVersion are never trusted from the client). */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) throw unauthorized();
    const payload = verifySession(token);
    if (!payload) throw unauthorized('Session expired. Please log in again.');
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.tokenVersion !== payload.tv) throw unauthorized('Session expired. Please log in again.');
    if (user.status !== 'ACTIVE') throw forbidden('This account is not active', 'ACCOUNT_INACTIVE');
    req.user = user;
    next();
  } catch (e) {
    next(e);
  }
}

export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };

export const adminOnly = [authenticate, requireRole('ADMIN')];
export const memberOnly = [authenticate, requireRole('MEMBER')];
