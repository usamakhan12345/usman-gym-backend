"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planDto = void 0;
exports.getSettings = getSettings;
exports.getPublicSite = getPublicSite;
const prisma_1 = require("../../lib/prisma");
const planDto = (p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    monthlyFee: p.monthlyFee.toString(),
    features: p.features,
    isPublic: p.isPublic,
    isActive: p.isActive,
    isFeatured: p.isFeatured,
    sortOrder: p.sortOrder,
});
exports.planDto = planDto;
async function getSettings() {
    const rows = await prisma_1.prisma.websiteSetting.findMany();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
/** Everything the public website needs, in one request. */
async function getPublicSite() {
    const [settings, plans, faqs, gallery] = await Promise.all([
        getSettings(),
        prisma_1.prisma.membershipPlan.findMany({ where: { isActive: true, isPublic: true }, orderBy: [{ sortOrder: 'asc' }, { monthlyFee: 'asc' }] }),
        prisma_1.prisma.faq.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
        prisma_1.prisma.galleryImage.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
    ]);
    // Payment instructions (bank/wallet details) are for logged-in members only, never the public site.
    const { payment: _private, ...publicSettings } = settings;
    return {
        settings: publicSettings,
        plans: plans.map(exports.planDto),
        faqs: faqs.map(({ id, question, answer }) => ({ id, question, answer })),
        gallery: gallery.map(({ id, url, caption, category }) => ({ id, url, caption, category })),
    };
}
