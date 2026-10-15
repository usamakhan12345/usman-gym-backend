import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { asyncHandler, clientIp, ok, paginated, uuidParam, validate } from '../../lib/http';
import { moneySchema } from '../../lib/identity';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import { getSettings, planDto } from './content.service';

/** Mounted inside the admin router, which already enforces ADMIN authentication. */
export const contentAdminRouter = Router();

// ---------------------------------------------------------------- membership plans
const planBase = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(500).default(''),
  monthlyFee: moneySchema,
  features: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
  isPublic: z.boolean().default(true),
  isActive: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});

contentAdminRouter.get('/plans', asyncHandler(async (_req, res) => {
  const plans = await prisma.membershipPlan.findMany({ orderBy: [{ sortOrder: 'asc' }, { monthlyFee: 'asc' }] });
  ok(res, plans.map(planDto));
}));

contentAdminRouter.post('/plans', validate({ body: planBase.strict() }), asyncHandler(async (req, res) => {
  const plan = await prisma.membershipPlan.create({ data: req.body });
  await audit({ actorId: req.user!.id, action: 'plan.create', entityType: 'MembershipPlan', entityId: plan.id, ip: clientIp(req) });
  ok(res, planDto(plan), 201);
}));

contentAdminRouter.patch(
  '/plans/:id',
  validate({ params: uuidParam('id'), body: planBase.partial().strict() }),
  asyncHandler(async (req, res) => {
    const exists = await prisma.membershipPlan.findUnique({ where: { id: req.params.id } });
    if (!exists) throw notFound('Plan not found');
    // Changing a plan's displayed price never rewrites any member's fee or past fee records.
    const plan = await prisma.membershipPlan.update({ where: { id: req.params.id }, data: req.body });
    await audit({ actorId: req.user!.id, action: 'plan.update', entityType: 'MembershipPlan', entityId: plan.id, metadata: req.body, ip: clientIp(req) });
    ok(res, planDto(plan));
  }),
);

contentAdminRouter.delete('/plans/:id', validate({ params: uuidParam('id') }), asyncHandler(async (req, res) => {
  const used = await prisma.membership.count({ where: { planId: req.params.id } });
  if (used > 0) {
    // Plans in use are archived rather than deleted so member records stay intact.
    await prisma.membershipPlan.update({ where: { id: req.params.id }, data: { isActive: false, isPublic: false } });
    return ok(res, { archived: true });
  }
  await prisma.membershipPlan.delete({ where: { id: req.params.id } }).catch((e) => {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') throw notFound('Plan not found');
    throw e;
  });
  ok(res, { archived: false });
}));

// ---------------------------------------------------------------- website settings
const settingsSchema = z
  .object({
    general: z.object({ gymName: z.string().max(80), tagline: z.string().max(160), description: z.string().max(600) }).strict().optional(),
    contact: z
      .object({
        address: z.string().max(300),
        phone: z.string().max(40),
        email: z.string().max(120),
        mapUrl: z.string().max(600).optional(),
        hours: z.array(z.object({ label: z.string().max(60), time: z.string().max(60) }).strict()).max(10),
      })
      .strict()
      .optional(),
    social: z.object({ facebook: z.string().max(300), instagram: z.string().max(300), youtube: z.string().max(300), twitter: z.string().max(300) }).partial().strict().optional(),
    membership: z.object({ note: z.string().max(400) }).strict().optional(),
    payment: z.object({ instructions: z.string().max(1000) }).strict().optional(),
  })
  .strict();

contentAdminRouter.get('/settings', asyncHandler(async (_req, res) => ok(res, await getSettings())));

contentAdminRouter.put('/settings', validate({ body: settingsSchema }), asyncHandler(async (req, res) => {
  await prisma.$transaction(
    Object.entries(req.body).map(([key, value]) =>
      prisma.websiteSetting.upsert({ where: { key }, create: { key, value: value as Prisma.InputJsonValue }, update: { value: value as Prisma.InputJsonValue } }),
    ),
  );
  await audit({ actorId: req.user!.id, action: 'settings.update', entityType: 'WebsiteSetting', metadata: { keys: Object.keys(req.body) }, ip: clientIp(req) });
  ok(res, await getSettings());
}));

// ---------------------------------------------------------------- FAQs
const faqSchema = z.object({
  question: z.string().trim().min(3).max(200),
  answer: z.string().trim().min(3).max(2000),
  sortOrder: z.number().int().min(0).max(1000).default(0),
  isActive: z.boolean().default(true),
});

contentAdminRouter.get('/faqs', asyncHandler(async (_req, res) => ok(res, await prisma.faq.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }))));
contentAdminRouter.post('/faqs', validate({ body: faqSchema.strict() }), asyncHandler(async (req, res) => ok(res, await prisma.faq.create({ data: req.body }), 201)));
contentAdminRouter.patch('/faqs/:id', validate({ params: uuidParam('id'), body: faqSchema.partial().strict() }), asyncHandler(async (req, res) => {
  ok(res, await prisma.faq.update({ where: { id: req.params.id }, data: req.body }).catch(() => { throw notFound('FAQ not found'); }));
}));
contentAdminRouter.delete('/faqs/:id', validate({ params: uuidParam('id') }), asyncHandler(async (req, res) => {
  await prisma.faq.delete({ where: { id: req.params.id } }).catch(() => { throw notFound('FAQ not found'); });
  ok(res, { deleted: true });
}));

// ---------------------------------------------------------------- gallery
const imageUrl = z.string().trim().max(600).refine((v) => /^https?:\/\//i.test(v) || v.startsWith('/'), 'Use an http(s) URL or a site path');
const gallerySchema = z.object({
  url: imageUrl,
  caption: z.string().trim().max(160).default(''),
  category: z.string().trim().min(1).max(40).default('Gym'),
  sortOrder: z.number().int().min(0).max(1000).default(0),
  isActive: z.boolean().default(true),
});

contentAdminRouter.get('/gallery', asyncHandler(async (_req, res) => ok(res, await prisma.galleryImage.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }))));
contentAdminRouter.post('/gallery', validate({ body: gallerySchema.strict() }), asyncHandler(async (req, res) => ok(res, await prisma.galleryImage.create({ data: req.body }), 201)));
contentAdminRouter.patch('/gallery/:id', validate({ params: uuidParam('id'), body: gallerySchema.partial().strict() }), asyncHandler(async (req, res) => {
  ok(res, await prisma.galleryImage.update({ where: { id: req.params.id }, data: req.body }).catch(() => { throw notFound('Image not found'); }));
}));
contentAdminRouter.delete('/gallery/:id', validate({ params: uuidParam('id') }), asyncHandler(async (req, res) => {
  await prisma.galleryImage.delete({ where: { id: req.params.id } }).catch(() => { throw notFound('Image not found'); });
  ok(res, { deleted: true });
}));

// ---------------------------------------------------------------- contact messages
contentAdminRouter.get(
  '/messages',
  validate({ query: z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) }) }),
  asyncHandler(async (req, res) => {
    const { page, limit } = req.query as any;
    const [total, items] = await Promise.all([
      prisma.contactMessage.count(),
      prisma.contactMessage.findMany({ orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
    ]);
    paginated(res, items, page, limit, total);
  }),
);
