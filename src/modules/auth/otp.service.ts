import { OtpPurpose, User } from '@prisma/client';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { generateOtp, hmac, safeEqual } from '../../lib/security';
import { otpEmail, otpSms } from '../../services/emailTemplates';
import { channelFor, deliver } from '../../services/messenger';

export const OTP_MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60_000;
const MAX_SENDS_PER_HOUR = 5;

/**
 * Issues and delivers an OTP. Returns false (without throwing) when throttled or when the
 * user has no deliverable contact, so callers can respond identically either way.
 * Throws if the provider itself fails.
 */
export async function issueOtp(user: User, purpose: OtpPurpose): Promise<boolean> {
  const target = channelFor(user);
  if (!target) {
    console.warn(`[otp] user ${user.id} has no contact the ${env.OTP_PROVIDER} provider can deliver to`);
    return false;
  }

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await prisma.otpVerification.findMany({
    where: { userId: user.id, purpose, createdAt: { gte: hourAgo } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  if (recent.length >= MAX_SENDS_PER_HOUR) return false;
  if (recent[0] && Date.now() - recent[0].createdAt.getTime() < RESEND_COOLDOWN_MS) return false;

  const code = env.OTP_DEV_CODE ?? generateOtp(); // OTP_DEV_CODE is validated as dev-only in config/env.ts
  // Invalidate earlier unused codes for this purpose; only the newest one is valid.
  await prisma.otpVerification.updateMany({
    where: { userId: user.id, purpose, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  const otp = await prisma.otpVerification.create({
    data: {
      userId: user.id,
      purpose,
      channel: target.channel,
      codeHash: hmac(`${user.id}:${purpose}:${code}`),
      expiresAt: new Date(Date.now() + env.OTP_TTL_MINUTES * 60_000),
    },
  });

  try {
    const email = otpEmail(purpose, code);
    await deliver(
      target.channel === 'EMAIL'
        ? { channel: 'EMAIL', to: target.to, subject: email.subject, text: email.text, html: email.html }
        : { channel: 'SMS', to: target.to, subject: email.subject, text: otpSms(code) },
    );
  } catch (err) {
    await prisma.otpVerification.delete({ where: { id: otp.id } });
    throw err;
  }
  return true;
}

/** Checks a submitted code. Counts failed attempts and locks the code after OTP_MAX_ATTEMPTS. */
export async function checkOtp(user: User, purpose: OtpPurpose, code: string): Promise<boolean> {
  const otp = await prisma.otpVerification.findFirst({
    where: { userId: user.id, purpose, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!otp || otp.expiresAt < new Date() || otp.attempts >= OTP_MAX_ATTEMPTS) return false;

  const valid = safeEqual(otp.codeHash, hmac(`${user.id}:${purpose}:${code}`));
  if (!valid) {
    await prisma.otpVerification.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    return false;
  }
  // Atomic consume: only one concurrent request can win.
  const consumed = await prisma.otpVerification.updateMany({
    where: { id: otp.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  return consumed.count === 1;
}
