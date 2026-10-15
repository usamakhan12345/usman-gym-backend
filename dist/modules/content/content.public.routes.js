"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publicRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const http_1 = require("../../lib/http");
const identity_1 = require("../../lib/identity");
const prisma_1 = require("../../lib/prisma");
const rateLimit_1 = require("../../middleware/rateLimit");
const content_service_1 = require("./content.service");
exports.publicRouter = (0, express_1.Router)();
exports.publicRouter.get('/site', (0, http_1.asyncHandler)(async (_req, res) => {
    res.set('Cache-Control', 'public, max-age=30');
    (0, http_1.ok)(res, await (0, content_service_1.getPublicSite)());
}));
const contactSchema = zod_1.z
    .object({
    name: zod_1.z.string().trim().min(2).max(100),
    email: identity_1.emailSchema,
    phone: zod_1.z.union([identity_1.phoneSchema, zod_1.z.literal('').transform(() => undefined)]).optional(),
    message: zod_1.z.string().trim().min(10, 'Please write at least 10 characters').max(2000),
})
    .strict();
exports.publicRouter.post('/contact', rateLimit_1.contactLimiter, (0, http_1.validate)({ body: contactSchema }), (0, http_1.asyncHandler)(async (req, res) => {
    await prisma_1.prisma.contactMessage.create({ data: req.body });
    (0, http_1.ok)(res, { message: 'Thanks! Your message has been sent. We will get back to you soon.' }, 201);
}));
