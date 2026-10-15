"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.changePasswordSchema = exports.resetPasswordSchema = exports.forgotPasswordSchema = exports.resendOtpSchema = exports.verifyOtpSchema = exports.loginSchema = exports.registerSchema = void 0;
const zod_1 = require("zod");
const identity_1 = require("../../lib/identity");
const otpCode = zod_1.z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code');
exports.registerSchema = zod_1.z
    .object({ fullName: identity_1.fullNameSchema, email: identity_1.emailSchema, phone: identity_1.phoneSchema, password: identity_1.passwordSchema })
    .strict();
exports.loginSchema = zod_1.z.object({ identifier: identity_1.identifierSchema, password: zod_1.z.string().min(1).max(200) }).strict();
exports.verifyOtpSchema = zod_1.z
    .object({ identifier: identity_1.identifierSchema, purpose: zod_1.z.enum(['SIGNUP', 'PASSWORD_RESET']), code: otpCode })
    .strict();
exports.resendOtpSchema = zod_1.z
    .object({ identifier: identity_1.identifierSchema, purpose: zod_1.z.enum(['SIGNUP', 'PASSWORD_RESET']) })
    .strict();
exports.forgotPasswordSchema = zod_1.z.object({ identifier: identity_1.identifierSchema }).strict();
exports.resetPasswordSchema = zod_1.z
    .object({ resetToken: zod_1.z.string().length(64), newPassword: identity_1.passwordSchema })
    .strict();
exports.changePasswordSchema = zod_1.z
    .object({ currentPassword: zod_1.z.string().min(1).max(200), newPassword: identity_1.passwordSchema })
    .strict();
