"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.notFoundHandler = notFoundHandler;
exports.errorHandler = errorHandler;
const client_1 = require("@prisma/client");
const multer_1 = __importDefault(require("multer"));
const errors_1 = require("../lib/errors");
const env_1 = require("../config/env");
function notFoundHandler(_req, res) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found' } });
}
function errorHandler(err, _req, res, _next) {
    if (err instanceof errors_1.AppError) {
        return res
            .status(err.status)
            .json({ success: false, error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err instanceof multer_1.default.MulterError) {
        const message = err.code === 'LIMIT_FILE_SIZE' ? `Image must be smaller than ${env_1.env.MAX_UPLOAD_MB} MB` : 'Invalid file upload';
        return res.status(400).json({ success: false, error: { code: 'BAD_UPLOAD', message } });
    }
    if (err instanceof client_1.Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return res
            .status(409)
            .json({ success: false, error: { code: 'CONFLICT', message: 'A record with these details already exists' } });
    }
    if (err?.type === 'entity.parse.failed') {
        return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Malformed JSON body' } });
    }
    console.error('[unhandled]', err);
    res.status(500).json({
        success: false,
        error: { code: 'INTERNAL', message: 'Something went wrong', ...(env_1.isProd ? {} : { details: String(err) }) },
    });
}
