import { Router } from 'express';
import { asyncHandler, clientIp, ok, validate } from '../../lib/http';
import { COOKIE_NAME, cookieOptions } from '../../lib/security';
import { authenticate } from '../../middleware/auth';
import { loginLimiter, otpSendLimiter, otpVerifyLimiter, registerLimiter } from '../../middleware/rateLimit';
import * as schemas from './auth.schemas';
import * as service from './auth.service';

export const authRouter = Router();

authRouter.post(
  '/register',
  registerLimiter,
  validate({ body: schemas.registerSchema }),
  asyncHandler(async (req, res) => {
    await service.register(req.body);
    ok(res, { message: service.GENERIC_SENT, identifier: req.body.email }, 202);
  }),
);

authRouter.post(
  '/login',
  loginLimiter,
  validate({ body: schemas.loginSchema }),
  asyncHandler(async (req, res) => {
    const user = await service.login(req.body.identifier, req.body.password);
    res.cookie(COOKIE_NAME, service.sessionTokenFor(user), cookieOptions());
    ok(res, await service.toSessionUser(user));
  }),
);

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
  ok(res, { message: 'Logged out' });
});

authRouter.post(
  '/verify-otp',
  otpVerifyLimiter,
  validate({ body: schemas.verifyOtpSchema }),
  asyncHandler(async (req, res) => {
    const { identifier, purpose, code } = req.body;
    const result = await service.verifyOtp(identifier, purpose, code);
    if (result.kind === 'session') {
      res.cookie(COOKIE_NAME, service.sessionTokenFor(result.user), cookieOptions());
      return ok(res, { purpose, user: await service.toSessionUser(result.user) });
    }
    ok(res, { purpose, resetToken: result.resetToken });
  }),
);

authRouter.post(
  '/resend-otp',
  otpSendLimiter,
  validate({ body: schemas.resendOtpSchema }),
  asyncHandler(async (req, res) => {
    await service.resendOtp(req.body.identifier, req.body.purpose);
    ok(res, { message: service.GENERIC_SENT });
  }),
);

authRouter.post(
  '/forgot-password',
  otpSendLimiter,
  validate({ body: schemas.forgotPasswordSchema }),
  asyncHandler(async (req, res) => {
    await service.forgotPassword(req.body.identifier);
    ok(res, { message: service.GENERIC_SENT });
  }),
);

authRouter.post(
  '/reset-password',
  otpVerifyLimiter,
  validate({ body: schemas.resetPasswordSchema }),
  asyncHandler(async (req, res) => {
    await service.resetPassword(req.body.resetToken, req.body.newPassword, clientIp(req));
    ok(res, { message: 'Password updated. You can now log in.' });
  }),
);

authRouter.post(
  '/change-password',
  authenticate,
  validate({ body: schemas.changePasswordSchema }),
  asyncHandler(async (req, res) => {
    const updated = await service.changePassword(req.user!, req.body.currentPassword, req.body.newPassword);
    res.cookie(COOKIE_NAME, service.sessionTokenFor(updated), cookieOptions());
    ok(res, { message: 'Password changed' });
  }),
);

authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    ok(res, await service.toSessionUser(req.user!));
  }),
);
