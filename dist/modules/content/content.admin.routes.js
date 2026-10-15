"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.contentAdminRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const client_1 = require("@prisma/client");
const http_1 = require("../../lib/http");
const identity_1 = require("../../lib/identity");
const prisma_1 = require("../../lib/prisma");
const audit_1 = require("../../lib/audit");
const errors_1 = require("../../lib/errors");
const content_service_1 = require("./content.service");
/** Mounted inside the admin router, which already enforces ADMIN authentication. */
exports.contentAdminRouter = (0, express_1.Router)();
// ---------------------------------------------------------------- membership plans
const planBase = zod_1.z.object({
    name: zod_1.z.string().trim().min(2).max(60),
    description: zod_1.z.string().trim().max(500).default(''),
    monthlyFee: identity_1.moneySchema,
    features: zod_1.z.array(zod_1.z.string().trim().min(1).max(120)).max(12).default([]),
    isPublic: zod_1.z.boolean().default(true),
    isActive: zod_1.z.boolean().default(true),
    isFeatured: zod_1.z.boolean().default(false),
    sortOrder: zod_1.z.number().int().min(0).max(1000).default(0),
});
exports.contentAdminRouter.get('/plans', (0, http_1.asyncHandler)(async (_req, res) => {
    const plans = await prisma_1.prisma.membershipPlan.findMany({ orderBy: [{ sortOrder: 'asc' }, { monthlyFee: 'asc' }] });
    (0, http_1.ok)(res, plans.map(content_service_1.planDto));
}));
exports.contentAdminRouter.post('/plans', (0, http_1.validate)({ body: planBase.strict() }), (0, http_1.asyncHandler)(async (req, res) => {
    const plan = await prisma_1.prisma.membershipPlan.create({ data: req.body });
    await (0, audit_1.audit)({ actorId: req.user.id, action: 'plan.create', entityType: 'MembershipPlan', entityId: plan.id, ip: (0, http_1.clientIp)(req) });
    (0, http_1.ok)(res, (0, content_service_1.planDto)(plan), 201);
}));
exports.contentAdminRouter.patch('/plans/:id', (0, http_1.validate)({ params: (0, http_1.uuidParam)('id'), body: planBase.partial().strict() }), (0, http_1.asyncHandler)(async (req, res) => {
    const exists = await prisma_1.prisma.membershipPlan.findUnique({ where: { id: req.params.id } });
    if (!exists)
        throw (0, errors_1.notFound)('Plan not found');
    // Changing a plan's displayed price never rewrites any member's fee or past fee records.
    const plan = await prisma_1.prisma.membershipPlan.update({ where: { id: req.params.id }, data: req.body });
    await (0, audit_1.audit)({ actorId: req.user.id, action: 'plan.update', entityType: 'MembershipPlan', entityId: plan.id, metadata: req.body, ip: (0, http_1.clientIp)(req) });
    (0, http_1.ok)(res, (0, content_service_1.planDto)(plan));
}));
exports.contentAdminRouter.delete('/plans/:id', (0, http_1.validate)({ params: (0, http_1.uuidParam)('id') }), (0, http_1.asyncHandler)(async (req, res) => {
    const used = await prisma_1.prisma.membership.count({ where: { planId: req.params.id } });
    if (used > 0) {
        // Plans in use are archived rather than deleted so member records stay intact.
        await prisma_1.prisma.membershipPlan.update({ where: { id: req.params.id }, data: { isActive: false, isPublic: false } });
        return (0, http_1.ok)(res, { archived: true });
    }
    await prisma_1.prisma.membershipPlan.delete({ where: { id: req.params.id } }).catch((e) => {
        if (e instanceof client_1.Prisma.PrismaClientKnownRequestError && e.code === 'P2025')
            throw (0, errors_1.notFound)('Plan not found');
        throw e;
    });
    (0, http_1.ok)(res, { archived: false });
}));
// ---------------------------------------------------------------- website settings
const settingsSchema = zod_1.z
    .object({
    general: zod_1.z.object({ gymName: zod_1.z.string().max(80), tagline: zod_1.z.string().max(160), description: zod_1.z.string().max(600) }).strict().optional(),
    contact: zod_1.z
        .object({
        address: zod_1.z.string().max(300),
        phone: zod_1.z.string().max(40),
        email: zod_1.z.string().max(120),
        mapUrl: zod_1.z.string().max(600).optional(),
        hours: zod_1.z.array(zod_1.z.object({ label: zod_1.z.string().max(60), time: zod_1.z.string().max(60) }).strict()).max(10),
    })
        .strict()
        .optional(),
    social: zod_1.z.object({ facebook: zod_1.z.string().max(300), instagram: zod_1.z.string().max(300), youtube: zod_1.z.string().max(300), twitter: zod_1.z.string().max(300) }).partial().strict().optional(),
    membership: zod_1.z.object({ note: zod_1.z.string().max(400) }).strict().optional(),
    payment: zod_1.z.object({ instructions: zod_1.z.string().max(1000) }).strict().optional(),
})
    .strict();
exports.contentAdminRouter.get('/settings', (0, http_1.asyncHandler)(async (_req, res) => (0, http_1.ok)(res, await (0, content_service_1.getSettings)())));
exports.contentAdminRouter.put('/settings', (0, http_1.validate)({ body: settingsSchema }), (0, http_1.asyncHandler)(async (req, res) => {
    await prisma_1.prisma.$transaction(Object.entries(req.body).map(([key, value]) => prisma_1.prisma.websiteSetting.upsert({ where: { key }, create: { key, value: value }, update: { value: value } })));
    await (0, audit_1.audit)({ actorId: req.user.id, action: 'settings.update', entityType: 'WebsiteSetting', metadata: { keys: Object.keys(req.body) }, ip: (0, http_1.clientIp)(req) });
    (0, http_1.ok)(res, await (0, content_service_1.getSettings)());
}));
// ---------------------------------------------------------------- FAQs
const faqSchema = zod_1.z.object({
    question: zod_1.z.string().trim().min(3).max(200),
    answer: zod_1.z.string().trim().min(3).max(2000),
    sortOrder: zod_1.z.number().int().min(0).max(1000).default(0),
    isActive: zod_1.z.boolean().default(true),
});
exports.contentAdminRouter.get('/faqs', (0, http_1.asyncHandler)(async (_req, res) => (0, http_1.ok)(res, await prisma_1.prisma.faq.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }))));
exports.contentAdminRouter.post('/faqs', (0, http_1.validate)({ body: faqSchema.strict() }), (0, http_1.asyncHandler)(async (req, res) => (0, http_1.ok)(res, await prisma_1.prisma.faq.create({ data: req.body }), 201)));
exports.contentAdminRouter.patch('/faqs/:id', (0, http_1.validate)({ params: (0, http_1.uuidParam)('id'), body: faqSchema.partial().strict() }), (0, http_1.asyncHandler)(async (req, res) => {
    (0, http_1.ok)(res, await prisma_1.prisma.faq.update({ where: { id: req.params.id }, data: req.body }).catch(() => { throw (0, errors_1.notFound)('FAQ not found'); }));
}));
exports.contentAdminRouter.delete('/faqs/:id', (0, http_1.validate)({ params: (0, http_1.uuidParam)('id') }), (0, http_1.asyncHandler)(async (req, res) => {
    await prisma_1.prisma.faq.delete({ where: { id: req.params.id } }).catch(() => { throw (0, errors_1.notFound)('FAQ not found'); });
    (0, http_1.ok)(res, { deleted: true });
}));
// ---------------------------------------------------------------- gallery
const imageUrl = zod_1.z.string().trim().max(600).refine((v) => /^https?:\/\//i.test(v) || v.startsWith('/'), 'Use an http(s) URL or a site path');
const gallerySchema = zod_1.z.object({
    url: imageUrl,
    caption: zod_1.z.string().trim().max(160).default(''),
    category: zod_1.z.string().trim().min(1).max(40).default('Gym'),
    sortOrder: zod_1.z.number().int().min(0).max(1000).default(0),
    isActive: zod_1.z.boolean().default(true),
});
exports.contentAdminRouter.get('/gallery', (0, http_1.asyncHandler)(async (_req, res) => (0, http_1.ok)(res, await prisma_1.prisma.galleryImage.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }))));
exports.contentAdminRouter.post('/gallery', (0, http_1.validate)({ body: gallerySchema.strict() }), (0, http_1.asyncHandler)(async (req, res) => (0, http_1.ok)(res, await prisma_1.prisma.galleryImage.create({ data: req.body }), 201)));
exports.contentAdminRouter.patch('/gallery/:id', (0, http_1.validate)({ params: (0, http_1.uuidParam)('id'), body: gallerySchema.partial().strict() }), (0, http_1.asyncHandler)(async (req, res) => {
    (0, http_1.ok)(res, await prisma_1.prisma.galleryImage.update({ where: { id: req.params.id }, data: req.body }).catch(() => { throw (0, errors_1.notFound)('Image not found'); }));
}));
exports.contentAdminRouter.delete('/gallery/:id', (0, http_1.validate)({ params: (0, http_1.uuidParam)('id') }), (0, http_1.asyncHandler)(async (req, res) => {
    await prisma_1.prisma.galleryImage.delete({ where: { id: req.params.id } }).catch(() => { throw (0, errors_1.notFound)('Image not found'); });
    (0, http_1.ok)(res, { deleted: true });
}));
// ---------------------------------------------------------------- contact messages
exports.contentAdminRouter.get('/messages', (0, http_1.validate)({ query: zod_1.z.object({ page: zod_1.z.coerce.number().int().min(1).default(1), limit: zod_1.z.coerce.number().int().min(1).max(100).default(20) }) }), (0, http_1.asyncHandler)(async (req, res) => {
    const { page, limit } = req.query;
    const [total, items] = await Promise.all([
        prisma_1.prisma.contactMessage.count(),
        prisma_1.prisma.contactMessage.findMany({ orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
    ]);
    (0, http_1.paginated)(res, items, page, limit, total);
}));
