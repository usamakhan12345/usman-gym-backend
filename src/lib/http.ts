import { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodTypeAny, z } from 'zod';
import { badRequest } from './errors';

export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export const ok = <T>(res: Response, data: T, status = 200) => res.status(status).json({ success: true, data });

export const paginated = <T>(res: Response, items: T[], page: number, limit: number, total: number) =>
  res.json({
    success: true,
    data: items,
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  });

/** Parses and replaces req.body / req.query / req.params, rejecting unknown keys when schema is strict. */
export const validate =
  (schemas: { body?: ZodTypeAny; query?: ZodTypeAny; params?: ZodTypeAny }): RequestHandler =>
  (req, _res, next) => {
    try {
      for (const part of ['body', 'query', 'params'] as const) {
        const schema = schemas[part];
        if (!schema) continue;
        const result = schema.safeParse(req[part] ?? {});
        if (!result.success) {
          throw badRequest('Validation failed', result.error.flatten().fieldErrors);
        }
        if (part === 'query') {
          Object.defineProperty(req, 'query', { value: result.data, writable: true, configurable: true });
        } else {
          (req as any)[part] = result.data;
        }
      }
      next();
    } catch (e) {
      next(e);
    }
  };

export const uuidParam = (name: string) => z.object({ [name]: z.string().uuid('Invalid id') });

export const clientIp = (req: Request) => req.ip ?? undefined;
