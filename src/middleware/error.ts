import { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import multer from 'multer';
import { AppError } from '../lib/errors';
import { env, isProd } from '../config/env';

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found' } });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res
      .status(err.status)
      .json({ success: false, error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof multer.MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE' ? `Image must be smaller than ${env.MAX_UPLOAD_MB} MB` : 'Invalid file upload';
    return res.status(400).json({ success: false, error: { code: 'BAD_UPLOAD', message } });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    return res
      .status(409)
      .json({ success: false, error: { code: 'CONFLICT', message: 'A record with these details already exists' } });
  }
  if ((err as any)?.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Malformed JSON body' } });
  }
  console.error('[unhandled]', err);
  res.status(500).json({
    success: false,
    error: { code: 'INTERNAL', message: 'Something went wrong', ...(isProd ? {} : { details: String(err) }) },
  });
}
