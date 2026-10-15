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
exports.contactLimiter = exports.registerLimiter = exports.otpSendLimiter = exports.otpVerifyLimiter = exports.loginLimiter = void 0;
const express_rate_limit_1 = __importStar(require("express-rate-limit"));
const env_1 = require("../config/env");
const make = (windowMinutes, max, message, keyBody) => (0, express_rate_limit_1.default)({
    windowMs: windowMinutes * 60 * 1000,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => env_1.isTest,
    // Limit per IP, and per target account when the body names one, to slow credential/OTP stuffing.
    keyGenerator: (req) => {
        const target = keyBody ? String(req.body?.[keyBody] ?? '').toLowerCase().slice(0, 100) : '';
        // ipKeyGenerator groups IPv6 addresses by /64 so rotating addresses inside one block cannot bypass the limit
        return `${(0, express_rate_limit_1.ipKeyGenerator)(req.ip ?? '')}|${target}`;
    },
    message: { success: false, error: { code: 'RATE_LIMITED', message } },
});
exports.loginLimiter = make(15, 10, 'Too many login attempts. Try again in a few minutes.', 'identifier');
exports.otpVerifyLimiter = make(15, 15, 'Too many verification attempts. Try again later.', 'identifier');
exports.otpSendLimiter = make(15, 5, 'Too many code requests. Try again later.', 'identifier');
exports.registerLimiter = make(60, 10, 'Too many sign-up attempts. Try again later.');
exports.contactLimiter = make(60, 5, 'Too many messages. Please try again later.');
