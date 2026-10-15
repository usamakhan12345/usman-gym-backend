"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cookieOptions = exports.COOKIE_NAME = exports.verifySession = exports.signSession = exports.generateToken = exports.generateOtp = exports.safeEqual = exports.hmac = exports.DUMMY_HASH = exports.verifyPassword = exports.hashPassword = void 0;
const crypto_1 = __importDefault(require("crypto"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const env_1 = require("../config/env");
const BCRYPT_ROUNDS = env_1.isTest ? 4 : 12; // low cost only to keep the test suite fast
const hashPassword = (plain) => bcryptjs_1.default.hash(plain, BCRYPT_ROUNDS);
exports.hashPassword = hashPassword;
const verifyPassword = (plain, hash) => bcryptjs_1.default.compare(plain, hash);
exports.verifyPassword = verifyPassword;
// Used to keep login timing similar when the account does not exist.
exports.DUMMY_HASH = bcryptjs_1.default.hashSync('not-a-real-password', BCRYPT_ROUNDS);
/** Keyed hash for OTPs / reset tokens so a DB leak does not reveal usable codes. */
const hmac = (value) => crypto_1.default.createHmac('sha256', env_1.env.JWT_SECRET).update(value).digest('hex');
exports.hmac = hmac;
const safeEqual = (a, b) => {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    return ba.length === bb.length && crypto_1.default.timingSafeEqual(ba, bb);
};
exports.safeEqual = safeEqual;
const generateOtp = () => crypto_1.default.randomInt(0, 1_000_000).toString().padStart(6, '0');
exports.generateOtp = generateOtp;
const generateToken = () => crypto_1.default.randomBytes(32).toString('hex');
exports.generateToken = generateToken;
const signSession = (payload) => jsonwebtoken_1.default.sign(payload, env_1.env.JWT_SECRET, { expiresIn: `${env_1.env.SESSION_DAYS}d` });
exports.signSession = signSession;
const verifySession = (token) => {
    try {
        return jsonwebtoken_1.default.verify(token, env_1.env.JWT_SECRET);
    }
    catch {
        return null;
    }
};
exports.verifySession = verifySession;
exports.COOKIE_NAME = 'ug_session';
const cookieOptions = () => ({
    httpOnly: true,
    sameSite: 'lax',
    secure: env_1.env.COOKIE_SECURE,
    path: '/',
    maxAge: env_1.env.SESSION_DAYS * 24 * 60 * 60 * 1000,
});
exports.cookieOptions = cookieOptions;
