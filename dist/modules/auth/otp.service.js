"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OTP_MAX_ATTEMPTS = void 0;
exports.issueOtp = issueOtp;
exports.checkOtp = checkOtp;
const env_1 = require("../../config/env");
const prisma_1 = require("../../lib/prisma");
const security_1 = require("../../lib/security");
const emailTemplates_1 = require("../../services/emailTemplates");
const messenger_1 = require("../../services/messenger");
exports.OTP_MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60_000;
const MAX_SENDS_PER_HOUR = 5;
/**
 * Issues and delivers an OTP. Returns false (without throwing) when throttled or when the
 * user has no deliverable contact, so callers can respond identically either way.
 * Throws if the provider itself fails.
 */
async function issueOtp(user, purpose) {
    const target = (0, messenger_1.channelFor)(user);
    if (!target) {
        console.warn(`[otp] user ${user.id} has no contact the ${env_1.env.OTP_PROVIDER} provider can deliver to`);
        return false;
    }
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recent = await prisma_1.prisma.otpVerification.findMany({
        where: { userId: user.id, purpose, createdAt: { gte: hourAgo } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
    });
    if (recent.length >= MAX_SENDS_PER_HOUR)
        return false;
    if (recent[0] && Date.now() - recent[0].createdAt.getTime() < RESEND_COOLDOWN_MS)
        return false;
    const code = env_1.env.OTP_DEV_CODE ?? (0, security_1.generateOtp)(); // OTP_DEV_CODE is validated as dev-only in config/env.ts
    // Invalidate earlier unused codes for this purpose; only the newest one is valid.
    await prisma_1.prisma.otpVerification.updateMany({
        where: { userId: user.id, purpose, consumedAt: null },
        data: { consumedAt: new Date() },
    });
    const otp = await prisma_1.prisma.otpVerification.create({
        data: {
            userId: user.id,
            purpose,
            channel: target.channel,
            codeHash: (0, security_1.hmac)(`${user.id}:${purpose}:${code}`),
            expiresAt: new Date(Date.now() + env_1.env.OTP_TTL_MINUTES * 60_000),
        },
    });
    try {
        const email = (0, emailTemplates_1.otpEmail)(purpose, code);
        await (0, messenger_1.deliver)(target.channel === 'EMAIL'
            ? { channel: 'EMAIL', to: target.to, subject: email.subject, text: email.text, html: email.html }
            : { channel: 'SMS', to: target.to, subject: email.subject, text: (0, emailTemplates_1.otpSms)(code) });
    }
    catch (err) {
        await prisma_1.prisma.otpVerification.delete({ where: { id: otp.id } });
        throw err;
    }
    return true;
}
/** Checks a submitted code. Counts failed attempts and locks the code after OTP_MAX_ATTEMPTS. */
async function checkOtp(user, purpose, code) {
    const otp = await prisma_1.prisma.otpVerification.findFirst({
        where: { userId: user.id, purpose, consumedAt: null },
        orderBy: { createdAt: 'desc' },
    });
    if (!otp || otp.expiresAt < new Date() || otp.attempts >= exports.OTP_MAX_ATTEMPTS)
        return false;
    const valid = (0, security_1.safeEqual)(otp.codeHash, (0, security_1.hmac)(`${user.id}:${purpose}:${code}`));
    if (!valid) {
        await prisma_1.prisma.otpVerification.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
        return false;
    }
    // Atomic consume: only one concurrent request can win.
    const consumed = await prisma_1.prisma.otpVerification.updateMany({
        where: { id: otp.id, consumedAt: null },
        data: { consumedAt: new Date() },
    });
    return consumed.count === 1;
}
