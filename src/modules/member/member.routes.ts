import { Router } from 'express';
import { asyncHandler, clientIp, ok, uuidParam, validate } from '../../lib/http';
import { forbidden } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { currentYearMonth, ymd } from '../../lib/dates';
import { prisma } from '../../lib/prisma';
import { deleteProfileImage, imageUpload, profileImageUrl, proofImageFile, proofUpload, saveProfileImage } from '../../lib/upload';
import { badRequest } from '../../lib/errors';
import { getSettings } from '../content/content.service';
import { getProofFile, latestProofsByFee, listMemberProofs, submitProof } from '../billing/proofs.service';
import { memberOnly } from '../../middleware/auth';
import { activePaymentInclude, feeDto, paymentDto } from '../billing/billing.dto';
import { generateFeesForMembership } from '../billing/billing.service';
import { z } from 'zod';

export const memberRouter = Router();
memberRouter.use(memberOnly);

/**
 * Every query below is scoped by the membership linked to the *authenticated* user.
 * No member id is ever read from the request, so there is nothing to tamper with.
 */
memberRouter.use(
  asyncHandler(async (req, _res, next) => {
    const membership = await prisma.membership.findUnique({ where: { userId: req.user!.id }, include: { plan: true } });
    if (!membership) {
      throw forbidden('Your account is not linked to a gym membership yet. Please contact the gym admin.', 'NO_MEMBERSHIP');
    }
    (req as any).membership = membership;
    next();
  }),
);

type Req = { membership: NonNullable<Awaited<ReturnType<typeof prisma.membership.findUnique>>> & { plan: { name: string } | null } };
const membershipOf = (req: unknown) => (req as Req).membership;

const membershipDto = (req: unknown) => {
  const m = membershipOf(req);
  return {
    gymId: m.gymId,
    fullName: m.fullName,
    phone: m.phone,
    email: m.email,
    joinedOn: ymd(m.joinedOn),
    monthlyFee: m.monthlyFee.toString(),
    plan: m.plan ? m.plan.name : null,
    status: m.status,
  };
};

memberRouter.get(
  '/profile',
  asyncHandler(async (req, res) => {
    ok(res, { ...membershipDto(req), profileImageUrl: profileImageUrl(req.user!.profileImage) });
  }),
);

memberRouter.get('/membership', asyncHandler(async (req, res) => ok(res, membershipDto(req))));

/**
 * The ONLY writable member field is the profile picture. The upload parser rejects any extra
 * form fields (fields: 0), so attempts to send name/phone/fee/etc. fail with 400.
 */
memberRouter.patch(
  '/profile-image',
  imageUpload,
  asyncHandler(async (req, res) => {
    const name = await saveProfileImage(req.file);
    const previous = req.user!.profileImage;
    await prisma.user.update({ where: { id: req.user!.id }, data: { profileImage: name } });
    await deleteProfileImage(previous);
    await audit({ actorId: req.user!.id, action: 'member.profile_image', entityType: 'User', entityId: req.user!.id, ip: clientIp(req) });
    ok(res, { profileImageUrl: profileImageUrl(name) });
  }),
);

memberRouter.get(
  '/fees',
  asyncHandler(async (req, res) => {
    const m = membershipOf(req);
    // Self-heal if the scheduled job missed a run: the portal never shows a stale month.
    await generateFeesForMembership(m);
    const fees = await prisma.monthlyFee.findMany({
      where: { membershipId: m.id },
      orderBy: [{ billingYear: 'desc' }, { billingMonth: 'desc' }],
      include: activePaymentInclude,
    });
    const proofs = await latestProofsByFee(m.id, fees.map((f) => f.id));
    const dto = fees.map((f) => ({ ...feeDto(f), proof: proofs.get(f.id) ?? null }));
    const outstanding = fees.filter((f) => f.status === 'PENDING');
    ok(res, {
      fees: dto,
      outstanding: {
        count: outstanding.length,
        amount: outstanding.reduce((s, f) => s + Number(f.amount), 0).toFixed(2),
      },
    });
  }),
);

memberRouter.get(
  '/fees/current',
  asyncHandler(async (req, res) => {
    const m = membershipOf(req);
    await generateFeesForMembership(m);
    const { year, month } = currentYearMonth();
    const [current, pending, lastPayment] = await Promise.all([
      prisma.monthlyFee.findUnique({
        where: { membershipId_billingYear_billingMonth: { membershipId: m.id, billingYear: year, billingMonth: month } },
        include: activePaymentInclude,
      }),
      prisma.monthlyFee.aggregate({ where: { membershipId: m.id, status: 'PENDING' }, _sum: { amount: true }, _count: true }),
      prisma.payment.findFirst({
        where: { membershipId: m.id, status: 'ACTIVE' },
        orderBy: [{ paidOn: 'desc' }, { createdAt: 'desc' }],
        include: { fee: { select: { billingYear: true, billingMonth: true } } },
      }),
    ]);
    res.set('Cache-Control', 'no-store');
    ok(res, {
      period: { year, month },
      // null when billing has not started yet for this member (e.g. NEXT_MONTH policy) or the membership is inactive
      currentFee: current ? feeDto(current) : null,
      outstanding: { count: pending._count, amount: (pending._sum.amount ?? 0).toString() },
      lastPayment: lastPayment
        ? { ...paymentDto(lastPayment), billingYear: lastPayment.fee.billingYear, billingMonth: lastPayment.fee.billingMonth }
        : null,
    });
  }),
);

memberRouter.get(
  '/payments',
  validate({ query: z.object({}).passthrough() }),
  asyncHandler(async (req, res) => {
    const payments = await prisma.payment.findMany({
      where: { membershipId: membershipOf(req).id, status: 'ACTIVE' }, // voided entries are admin-audit only
      orderBy: [{ paidOn: 'desc' }, { createdAt: 'desc' }],
      include: { recordedBy: { select: { fullName: true } }, fee: { select: { billingYear: true, billingMonth: true } } },
    });
    res.set('Cache-Control', 'no-store');
    ok(
      res,
      payments.map((p) => ({ ...paymentDto(p), recordedBy: undefined, billingYear: p.fee.billingYear, billingMonth: p.fee.billingMonth })),
    );
  }),
);

// ---------------------------------------------------------------- online payment screenshots
const proofBody = z
  .object({
    method: z.enum(['BANK_TRANSFER', 'OTHER']),
    reference: z.string().trim().max(100).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

/** Bank/wallet instructions the admin configured. Only visible to logged-in members, not on the public site. */
memberRouter.get(
  '/payment-info',
  asyncHandler(async (_req, res) => {
    const settings = await getSettings();
    ok(res, { instructions: (settings.payment as { instructions?: string } | undefined)?.instructions ?? '' });
  }),
);

memberRouter.post(
  '/fees/:feeId/proof',
  validate({ params: uuidParam('feeId') }),
  proofUpload,
  asyncHandler(async (req, res) => {
    const parsed = proofBody.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest('Validation failed', parsed.error.flatten().fieldErrors);
    ok(res, await submitProof(membershipOf(req), req.params.feeId, parsed.data, req.file, clientIp(req)), 201);
  }),
);

memberRouter.get('/proofs', asyncHandler(async (req, res) => ok(res, await listMemberProofs(membershipOf(req).id))));

memberRouter.get(
  '/proofs/:id/image',
  validate({ params: uuidParam('id') }),
  asyncHandler(async (req, res) => {
    const file = await getProofFile(req.params.id, membershipOf(req).id); // 404 unless it is THIS member's proof
    res.set({ 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' });
    res.sendFile(proofImageFile(file));
  }),
);
