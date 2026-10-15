import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env, isTest } from './config/env';
import { PROFILE_PUBLIC_DIR } from './lib/upload';
import { errorHandler, notFoundHandler } from './middleware/error';
import { adminRouter } from './modules/admin/admin.routes';
import { authRouter } from './modules/auth/auth.routes';
import { publicRouter } from './modules/content/content.public.routes';
import { memberRouter } from './modules/member/member.routes';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // behind the Next.js proxy / a reverse proxy: use the real client IP for rate limits
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin: env.FRONTEND_URL.split(',').map((s) => s.trim()),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  if (!isTest) app.use((req, _res, next) => (console.log(`${req.method} ${req.originalUrl}`), next()));

  // Only the profile image folder is served, never the whole upload directory.
  app.use('/uploads/profiles', express.static(PROFILE_PUBLIC_DIR, { index: false, dotfiles: 'deny', maxAge: '1h' }));

  app.get('/api/health', (_req, res) => res.json({ success: true, data: { status: 'ok' } }));
  app.use('/api/auth', authRouter);
  app.use('/api/public', publicRouter);
  app.use('/api/member', memberRouter);
  app.use('/api/admin', adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}


