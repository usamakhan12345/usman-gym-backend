"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRouter = void 0;
const express_1 = require("express");
const http_1 = require("../../lib/http");
const security_1 = require("../../lib/security");
const auth_1 = require("../../middleware/auth");
const rateLimit_1 = require("../../middleware/rateLimit");
const schemas = __importStar(require("./auth.schemas"));
const service = __importStar(require("./auth.service"));
exports.authRouter = (0, express_1.Router)();
exports.authRouter.post('/register', rateLimit_1.registerLimiter, (0, http_1.validate)({ body: schemas.registerSchema }), (0, http_1.asyncHandler)(async (req, res) => {
    await service.register(req.body);
    (0, http_1.ok)(res, { message: service.GENERIC_SENT, identifier: req.body.email }, 202);
}));
exports.authRouter.post('/login', rateLimit_1.loginLimiter, (0, http_1.validate)({ body: schemas.loginSchema }), (0, http_1.asyncHandler)(async (req, res) => {
    const user = await service.login(req.body.identifier, req.body.password);
    res.cookie(security_1.COOKIE_NAME, service.sessionTokenFor(user), (0, security_1.cookieOptions)());
    (0, http_1.ok)(res, await service.toSessionUser(user));
}));
exports.authRouter.post('/logout', (_req, res) => {
    res.clearCookie(security_1.COOKIE_NAME, { ...(0, security_1.cookieOptions)(), maxAge: undefined });
    (0, http_1.ok)(res, { message: 'Logged out' });
});
exports.authRouter.post('/verify-otp', rateLimit_1.otpVerifyLimiter, (0, http_1.validate)({ body: schemas.verifyOtpSchema }), (0, http_1.asyncHandler)(async (req, res) => {
    const { identifier, purpose, code } = req.body;
    const result = await service.verifyOtp(identifier, purpose, code);
    if (result.kind === 'session') {
        res.cookie(security_1.COOKIE_NAME, service.sessionTokenFor(result.user), (0, security_1.cookieOptions)());
        return (0, http_1.ok)(res, { purpose, user: await service.toSessionUser(result.user) });
    }
    (0, http_1.ok)(res, { purpose, resetToken: result.resetToken });
}));
exports.authRouter.post('/resend-otp', rateLimit_1.otpSendLimiter, (0, http_1.validate)({ body: schemas.resendOtpSchema }), (0, http_1.asyncHandler)(async (req, res) => {
    await service.resendOtp(req.body.identifier, req.body.purpose);
    (0, http_1.ok)(res, { message: service.GENERIC_SENT });
}));
exports.authRouter.post('/forgot-password', rateLimit_1.otpSendLimiter, (0, http_1.validate)({ body: schemas.forgotPasswordSchema }), (0, http_1.asyncHandler)(async (req, res) => {
    await service.forgotPassword(req.body.identifier);
    (0, http_1.ok)(res, { message: service.GENERIC_SENT });
}));
exports.authRouter.post('/reset-password', rateLimit_1.otpVerifyLimiter, (0, http_1.validate)({ body: schemas.resetPasswordSchema }), (0, http_1.asyncHandler)(async (req, res) => {
    await service.resetPassword(req.body.resetToken, req.body.newPassword, (0, http_1.clientIp)(req));
    (0, http_1.ok)(res, { message: 'Password updated. You can now log in.' });
}));
exports.authRouter.post('/change-password', auth_1.authenticate, (0, http_1.validate)({ body: schemas.changePasswordSchema }), (0, http_1.asyncHandler)(async (req, res) => {
    const updated = await service.changePassword(req.user, req.body.currentPassword, req.body.newPassword);
    res.cookie(security_1.COOKIE_NAME, service.sessionTokenFor(updated), (0, security_1.cookieOptions)());
    (0, http_1.ok)(res, { message: 'Password changed' });
}));
exports.authRouter.get('/me', auth_1.authenticate, (0, http_1.asyncHandler)(async (req, res) => {
    (0, http_1.ok)(res, await service.toSessionUser(req.user));
}));
