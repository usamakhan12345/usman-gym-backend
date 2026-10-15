"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.forgotPassword = exports.sessionTokenFor = exports.GENERIC_SENT = void 0;
exports.toSessionUser = toSessionUser;
exports.register = register;
exports.login = login;
exports.verifyOtp = verifyOtp;
exports.resendOtp = resendOtp;
exports.resetPassword = resetPassword;
exports.changePassword = changePassword;
const prisma_1 = require("../../lib/prisma");
const errors_1 = require("../../lib/errors");
const identity_1 = require("../../lib/identity");
const security_1 = require("../../lib/security");
const upload_1 = require("../../lib/upload");
const audit_1 = require("../../lib/audit");
const otp_service_1 = require("./otp.service");
const RESET_TOKEN_TTL_MS = 15 * 60_000;
const INVALID_CODE = () => new errors_1.AppError(400, 'INVALID_CODE', 'Invalid or expired code');
const INVALID_CREDENTIALS = () => new errors_1.AppError(401, 'INVALID_CREDENTIALS', 'Invalid email/phone or password');
exports.GENERIC_SENT = 'If the details are valid, a verification code has been sent.';
async function toSessionUser(user) {
    const membership = user.role === 'MEMBER'
        ? await prisma_1.prisma.membership.findUnique({ where: { userId: user.id }, select: { gymId: true, status: true } })
        : null;
    let accountState;
    if (user.role === 'ADMIN')
        accountState = 'ADMIN';
    else if (!membership)
        accountState = 'MEMBER_UNLINKED';
    else
        accountState = membership.status === 'ACTIVE' ? 'MEMBER_ACTIVE' : 'MEMBER_INACTIVE';
    return {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
        profileImageUrl: (0, upload_1.profileImageUrl)(user.profileImage),
        accountState,
        membership,
    };
}
const sessionTokenFor = (user) => (0, security_1.signSession)({ sub: user.id, role: user.role, tv: user.tokenVersion });
exports.sessionTokenFor = sessionTokenFor;
async function register(input) {
    const matches = await prisma_1.prisma.user.findMany({
        where: { OR: [{ email: input.email }, { phone: input.phone }] },
    });
    // Several accounts involved (email on one, phone on another) is always ambiguous: treat as taken.
    const existing = matches.length === 1 ? matches[0] : undefined;
    let user;
    if (matches.length > 1) {
        console.warn('[register] ignored: email and phone belong to two different existing accounts (no code sent)');
        return; // respond like success so accounts can't be enumerated
    }
    else if (!existing) {
        user = await prisma_1.prisma.user.create({
            data: {
                fullName: input.fullName,
                email: input.email,
                phone: input.phone,
                passwordHash: await (0, security_1.hashPassword)(input.password),
                role: 'MEMBER',
                status: 'PENDING_VERIFICATION',
            },
        });
    }
    else if (existing.status === 'PENDING_VERIFICATION') {
        // Abandoned, never-verified sign-up (it has no access to anything): the new attempt replaces it, so a typo
        // in email/phone on the first try can't lock the person out of signing up again.
        user = await prisma_1.prisma.user.update({
            where: { id: existing.id },
            data: { fullName: input.fullName, email: input.email, phone: input.phone, passwordHash: await (0, security_1.hashPassword)(input.password) },
        });
        if (existing.email !== input.email) {
            // New destination: codes sent to the old address (and their resend cooldown) no longer apply.
            await prisma_1.prisma.otpVerification.deleteMany({ where: { userId: user.id, purpose: 'SIGNUP' } });
        }
    }
    else {
        // Contact already in use. Respond exactly like success so accounts can't be enumerated.
        // (Logged server-side only, so the developer can see why no code was sent.)
        const which = existing.email === input.email ? 'email' : 'phone';
        console.warn(`[register] ignored: ${which} is already used by a ${existing.status} account (no code sent)`);
        return;
    }
    await (0, otp_service_1.issueOtp)(user, 'SIGNUP');
}
async function login(identifier, password) {
    const user = await prisma_1.prisma.user.findFirst({ where: (0, identity_1.identifierWhere)(identifier) });
    const hash = user?.passwordHash ?? security_1.DUMMY_HASH;
    const valid = await (0, security_1.verifyPassword)(password, hash);
    if (!user || !user.passwordHash || !valid)
        throw INVALID_CREDENTIALS();
    if (user.status === 'DISABLED')
        throw (0, errors_1.forbidden)('This account has been disabled. Contact the gym.', 'ACCOUNT_DISABLED');
    if (user.status === 'PENDING_VERIFICATION') {
        await (0, otp_service_1.issueOtp)(user, 'SIGNUP').catch(() => undefined);
        throw new errors_1.AppError(403, 'NOT_VERIFIED', 'Please verify your account with the code we sent you.');
    }
    if (user.status !== 'ACTIVE')
        throw INVALID_CREDENTIALS();
    return user;
}
async function verifyOtp(identifier, purpose, code) {
    const user = await prisma_1.prisma.user.findFirst({ where: (0, identity_1.identifierWhere)(identifier) });
    if (!user)
        throw INVALID_CODE();
    if (purpose === 'SIGNUP' && user.status !== 'PENDING_VERIFICATION')
        throw INVALID_CODE();
    if (purpose === 'PASSWORD_RESET' && !['ACTIVE', 'INVITED'].includes(user.status))
        throw INVALID_CODE();
    if (!(await (0, otp_service_1.checkOtp)(user, purpose, code)))
        throw INVALID_CODE();
    if (purpose === 'SIGNUP') {
        const verified = await prisma_1.prisma.user.update({
            where: { id: user.id },
            data: { status: 'ACTIVE', verifiedAt: new Date() },
        });
        return { kind: 'session', user: verified };
    }
    const resetToken = (0, security_1.generateToken)();
    await prisma_1.prisma.passwordResetRequest.create({
        data: { userId: user.id, tokenHash: (0, security_1.hmac)(resetToken), expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
    });
    return { kind: 'reset', resetToken };
}
async function resendOtp(identifier, purpose) {
    const user = await prisma_1.prisma.user.findFirst({ where: (0, identity_1.identifierWhere)(identifier) });
    if (!user)
        return;
    const eligible = purpose === 'SIGNUP' ? user.status === 'PENDING_VERIFICATION' : ['ACTIVE', 'INVITED'].includes(user.status);
    if (eligible)
        await (0, otp_service_1.issueOtp)(user, purpose);
}
const forgotPassword = (identifier) => resendOtp(identifier, 'PASSWORD_RESET');
exports.forgotPassword = forgotPassword;
async function resetPassword(resetToken, newPassword, ip) {
    const request = await prisma_1.prisma.passwordResetRequest.findUnique({ where: { tokenHash: (0, security_1.hmac)(resetToken) } });
    if (!request || request.usedAt || request.expiresAt < new Date()) {
        throw new errors_1.AppError(400, 'INVALID_RESET_TOKEN', 'This reset link has expired. Please start again.');
    }
    const passwordHash = await (0, security_1.hashPassword)(newPassword);
    await prisma_1.prisma.$transaction(async (tx) => {
        const claimed = await tx.passwordResetRequest.updateMany({
            where: { id: request.id, usedAt: null },
            data: { usedAt: new Date() },
        });
        if (claimed.count !== 1)
            throw new errors_1.AppError(400, 'INVALID_RESET_TOKEN', 'This reset link has already been used.');
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
        await (0, audit_1.audit)({ actorId: user.id, action: 'auth.password_reset', entityType: 'User', entityId: user.id, ip }, tx);
    });
}
async function changePassword(user, currentPassword, newPassword) {
    if (!user.passwordHash || !(await (0, security_1.verifyPassword)(currentPassword, user.passwordHash))) {
        throw (0, errors_1.badRequest)('Current password is incorrect');
    }
    const updated = await prisma_1.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await (0, security_1.hashPassword)(newPassword), tokenVersion: { increment: 1 } },
    });
    return updated; // caller re-issues a fresh session for this device
}
