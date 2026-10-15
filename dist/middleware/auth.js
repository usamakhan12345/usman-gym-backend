"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.memberOnly = exports.adminOnly = exports.requireRole = void 0;
exports.authenticate = authenticate;
const prisma_1 = require("../lib/prisma");
const errors_1 = require("../lib/errors");
const security_1 = require("../lib/security");
/** Loads the session user from the DB on every request (role/status/tokenVersion are never trusted from the client). */
async function authenticate(req, _res, next) {
    try {
        const token = req.cookies?.[security_1.COOKIE_NAME];
        if (!token)
            throw (0, errors_1.unauthorized)();
        const payload = (0, security_1.verifySession)(token);
        if (!payload)
            throw (0, errors_1.unauthorized)('Session expired. Please log in again.');
        const user = await prisma_1.prisma.user.findUnique({ where: { id: payload.sub } });
        if (!user || user.tokenVersion !== payload.tv)
            throw (0, errors_1.unauthorized)('Session expired. Please log in again.');
        if (user.status !== 'ACTIVE')
            throw (0, errors_1.forbidden)('This account is not active', 'ACCOUNT_INACTIVE');
        req.user = user;
        next();
    }
    catch (e) {
        next(e);
    }
}
const requireRole = (...roles) => (req, _res, next) => {
    if (!req.user)
        return next((0, errors_1.unauthorized)());
    if (!roles.includes(req.user.role))
        return next((0, errors_1.forbidden)());
    next();
};
exports.requireRole = requireRole;
exports.adminOnly = [authenticate, (0, exports.requireRole)('ADMIN')];
exports.memberOnly = [authenticate, (0, exports.requireRole)('MEMBER')];
