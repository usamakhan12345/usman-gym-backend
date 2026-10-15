"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clientIp = exports.uuidParam = exports.validate = exports.paginated = exports.ok = exports.asyncHandler = void 0;
const zod_1 = require("zod");
const errors_1 = require("./errors");
const asyncHandler = (fn) => (req, res, next) => {
    fn(req, res, next).catch(next);
};
exports.asyncHandler = asyncHandler;
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
exports.ok = ok;
const paginated = (res, items, page, limit, total) => res.json({
    success: true,
    data: items,
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
});
exports.paginated = paginated;
/** Parses and replaces req.body / req.query / req.params, rejecting unknown keys when schema is strict. */
const validate = (schemas) => (req, _res, next) => {
    try {
        for (const part of ['body', 'query', 'params']) {
            const schema = schemas[part];
            if (!schema)
                continue;
            const result = schema.safeParse(req[part] ?? {});
            if (!result.success) {
                throw (0, errors_1.badRequest)('Validation failed', result.error.flatten().fieldErrors);
            }
            if (part === 'query') {
                Object.defineProperty(req, 'query', { value: result.data, writable: true, configurable: true });
            }
            else {
                req[part] = result.data;
            }
        }
        next();
    }
    catch (e) {
        next(e);
    }
};
exports.validate = validate;
const uuidParam = (name) => zod_1.z.object({ [name]: zod_1.z.string().uuid('Invalid id') });
exports.uuidParam = uuidParam;
const clientIp = (req) => req.ip ?? undefined;
exports.clientIp = clientIp;
