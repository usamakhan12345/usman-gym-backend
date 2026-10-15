"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.conflict = exports.notFound = exports.forbidden = exports.unauthorized = exports.badRequest = exports.AppError = void 0;
class AppError extends Error {
    status;
    code;
    details;
    constructor(status, code, message, details) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
    }
}
exports.AppError = AppError;
const badRequest = (message, details) => new AppError(400, 'BAD_REQUEST', message, details);
exports.badRequest = badRequest;
const unauthorized = (message = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', message);
exports.unauthorized = unauthorized;
const forbidden = (message = 'You do not have permission to do this', code = 'FORBIDDEN') => new AppError(403, code, message);
exports.forbidden = forbidden;
const notFound = (message = 'Not found') => new AppError(404, 'NOT_FOUND', message);
exports.notFound = notFound;
const conflict = (message, code = 'CONFLICT') => new AppError(409, code, message);
exports.conflict = conflict;
