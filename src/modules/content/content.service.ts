import { MembershipPlan } from '@prisma/client';
import { prisma } from '../../lib/prisma';

export const planDto = (p: MembershipPlan) => ({
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

export async function getSettings() {
  const rows = await prisma.websiteSetting.findMany();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/** Everything the public website needs, in one request. */
export async function getPublicSite() {
  const [settings, plans, faqs, gallery] = await Promise.all([
    getSettings(),
    prisma.membershipPlan.findMany({ where: { isActive: true, isPublic: true }, orderBy: [{ sortOrder: 'asc' }, { monthlyFee: 'asc' }] }),
    prisma.faq.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
    prisma.galleryImage.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
  ]);
  // Payment instructions (bank/wallet details) are for logged-in members only, never the public site.
  const { payment: _private, ...publicSettings } = settings;
  return {
    settings: publicSettings,
    plans: plans.map(planDto),
    faqs: faqs.map(({ id, question, answer }) => ({ id, question, answer })),
    gallery: gallery.map(({ id, url, caption, category }) => ({ id, url, caption, category })),
  };
}
