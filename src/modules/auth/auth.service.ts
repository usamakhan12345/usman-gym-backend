import { OtpPurpose, User } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError, badRequest, forbidden } from '../../lib/errors';
import { identifierWhere } from '../../lib/identity';
import {
  DUMMY_HASH,
  generateToken,
  hashPassword,
  hmac,
  signSession,
  verifyPassword,
} from '../../lib/security';
import { profileImageUrl } from '../../lib/upload';
import { audit } from '../../lib/audit';
import { checkOtp, issueOtp } from './otp.service';

const RESET_TOKEN_TTL_MS = 15 * 60_000;
const INVALID_CODE = () => new AppError(400, 'INVALID_CODE', 'Invalid or expired code');
const INVALID_CREDENTIALS = () => new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email/phone or password');

export const GENERIC_SENT = 'If the details are valid, a verification code has been sent.';

export async function toSessionUser(user: User) {
  const membership =
    user.role === 'MEMBER'
      ? await prisma.membership.findUnique({ where: { userId: user.id }, select: { gymId: true, status: true } })
      : null;

  let accountState: 'ADMIN' | 'MEMBER_ACTIVE' | 'MEMBER_INACTIVE' | 'MEMBER_UNLINKED';
  if (user.role === 'ADMIN') accountState = 'ADMIN';
  else if (!membership) accountState = 'MEMBER_UNLINKED';
  else accountState = membership.status === 'ACTIVE' ? 'MEMBER_ACTIVE' : 'MEMBER_INACTIVE';

  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
    profileImageUrl: profileImageUrl(user.profileImage),
    accountState,
    membership,
  };
}

export const sessionTokenFor = (user: User) => signSession({ sub: user.id, role: user.role, tv: user.tokenVersion });

export async function register(input: { fullName: string; email: string; phone: string; password: string }) {
  const matches = await prisma.user.findMany({
    where: { OR: [{ email: input.email }, { phone: input.phone }] },
  });
  // Several accounts involved (email on one, phone on another) is always ambiguous: treat as taken.
  const existing = matches.length === 1 ? matches[0] : undefined;

  let user: User;
  if (matches.length > 1) {
    console.warn('[register] ignored: email and phone belong to two different existing accounts (no code sent)');
    return; // respond like success so accounts can't be enumerated
  } else if (!existing) {
    user = await prisma.user.create({
      data: {
        fullName: input.fullName,
        email: input.email,
        phone: input.phone,
        passwordHash: await hashPassword(input.password),
        role: 'MEMBER',
        status: 'PENDING_VERIFICATION',
      },
    });
  } else if (existing.status === 'PENDING_VERIFICATION') {
    // Abandoned, never-verified sign-up (it has no access to anything): the new attempt replaces it, so a typo
    // in email/phone on the first try can't lock the person out of signing up again.
    user = await prisma.user.update({
      where: { id: existing.id },
      data: { fullName: input.fullName, email: input.email, phone: input.phone, passwordHash: await hashPassword(input.password) },
    });
    if (existing.email !== input.email) {
      // New destination: codes sent to the old address (and their resend cooldown) no longer apply.
      await prisma.otpVerification.deleteMany({ where: { userId: user.id, purpose: 'SIGNUP' } });
    }
  } else {
    // Contact already in use. Respond exactly like success so accounts can't be enumerated.
    // (Logged server-side only, so the developer can see why no code was sent.)
    const which = existing.email === input.email ? 'email' : 'phone';
    console.warn(`[register] ignored: ${which} is already used by a ${existing.status} account (no code sent)`);
    return;
  }
  await issueOtp(user, 'SIGNUP');
}

export async function login(identifier: string, password: string) {
  const user = await prisma.user.findFirst({ where: identifierWhere(identifier) });
  const hash = user?.passwordHash ?? DUMMY_HASH;
  const valid = await verifyPassword(password, hash);
  if (!user || !user.passwordHash || !valid) throw INVALID_CREDENTIALS();

  if (user.status === 'DISABLED') throw forbidden('This account has been disabled. Contact the gym.', 'ACCOUNT_DISABLED');
  if (user.status === 'PENDING_VERIFICATION') {
    await issueOtp(user, 'SIGNUP').catch(() => undefined);
    throw new AppError(403, 'NOT_VERIFIED', 'Please verify your account with the code we sent you.');
  }
  if (user.status !== 'ACTIVE') throw INVALID_CREDENTIALS();
  return user;
}

export async function verifyOtp(identifier: string, purpose: OtpPurpose, code: string) {
  const user = await prisma.user.findFirst({ where: identifierWhere(identifier) });
  if (!user) throw INVALID_CODE();
  if (purpose === 'SIGNUP' && user.status !== 'PENDING_VERIFICATION') throw INVALID_CODE();
  if (purpose === 'PASSWORD_RESET' && !['ACTIVE', 'INVITED'].includes(user.status)) throw INVALID_CODE();

  if (!(await checkOtp(user, purpose, code))) throw INVALID_CODE();

  if (purpose === 'SIGNUP') {
    const verified = await prisma.user.update({
      where: { id: user.id },
      data: { status: 'ACTIVE', verifiedAt: new Date() },
    });
    return { kind: 'session' as const, user: verified };
  }

  const resetToken = generateToken();
  await prisma.passwordResetRequest.create({
    data: { userId: user.id, tokenHash: hmac(resetToken), expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
  });
  return { kind: 'reset' as const, resetToken };
}

export async function resendOtp(identifier: string, purpose: OtpPurpose) {
  const user = await prisma.user.findFirst({ where: identifierWhere(identifier) });
  if (!user) return;
  const eligible =
    purpose === 'SIGNUP' ? user.status === 'PENDING_VERIFICATION' : ['ACTIVE', 'INVITED'].includes(user.status);
  if (eligible) await issueOtp(user, purpose);
}

export const forgotPassword = (identifier: string) => resendOtp(identifier, 'PASSWORD_RESET');

export async function resetPassword(resetToken: string, newPassword: string, ip?: string) {
  const request = await prisma.passwordResetRequest.findUnique({ where: { tokenHash: hmac(resetToken) } });
  if (!request || request.usedAt || request.expiresAt < new Date()) {
    throw new AppError(400, 'INVALID_RESET_TOKEN', 'This reset link has expired. Please start again.');
  }
  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.passwordResetRequest.updateMany({
      where: { id: request.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) throw new AppError(400, 'INVALID_RESET_TOKEN', 'This reset link has already been used.');
    const user = await tx.user.findUniqueOrThrow({ where: { id: request.userId } });
    await tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        // Completing the reset proves control of the contact: this also activates admin-invited members.
        status: user.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE',
        verifiedAt: user.verifiedAt ?? new Date(),
        tokenVersion: { increment: 1 }, // signs out all existing sessions
      },
    });
    await audit({ actorId: user.id, action: 'auth.password_reset', entityType: 'User', entityId: user.id, ip }, tx);
  });
}

export async function changePassword(user: User, currentPassword: string, newPassword: string) {
  if (!user.passwordHash || !(await verifyPassword(currentPassword, user.passwordHash))) {
    throw badRequest('Current password is incorrect');
  }
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(newPassword), tokenVersion: { increment: 1 } },
  });
  return updated; // caller re-issues a fresh session for this device
}


