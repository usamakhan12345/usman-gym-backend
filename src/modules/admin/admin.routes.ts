import { Router } from 'express';
import { asyncHandler, clientIp, ok, paginated, uuidParam, validate } from '../../lib/http';
import { adminOnly } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { deleteProfileImage, imageUpload, profileImageUrl, saveProfileImage } from '../../lib/upload';
import { notFound } from '../../lib/errors';
import { generateMissingFees } from '../billing/billing.service';
import { correctPayment, markFeePaid } from '../billing/payments.service';
import * as schemas from './members.schemas';
import * as members from './members.service';
import * as fees from './fees.service';
import { approveProof, listProofs, pendingProofCount, rejectProof, getProofFile } from '../billing/proofs.service';
import { proofImageFile } from '../../lib/upload';
import { z } from 'zod';
import { contentAdminRouter } from '../content/content.admin.routes';

export const adminRouter = Router();
adminRouter.use(adminOnly);

// ---------------------------------------------------------------- dashboard
adminRouter.get(
  '/dashboard/stats',
  asyncHandler(async (_req, res) => ok(res, { ...(await fees.dashboardStats()), pendingProofs: await pendingProofCount() })),
);

// ---------------------------------------------------------------- members
adminRouter.post(
  '/members',
  validate({ body: schemas.createMemberSchema }),
  asyncHandler(async (req, res) => ok(res, await members.createMember(req.body, req.user!.id, clientIp(req)), 201)),
);

adminRouter.get(
  '/members',
  validate({ query: schemas.listMembersQuery }),
  asyncHandler(async (req, res) => {
    const q = req.query as any;
    const { items, total } = await members.listMembers(q);
    paginated(res, items, q.page, q.limit, total);
  }),
);

adminRouter.get(
  '/members/unlinked-users',
  asyncHandler(async (_req, res) => ok(res, await members.listUnlinkedUsers())),
);

const memberId = validate({ params: uuidParam('memberId') });

adminRouter.get('/members/:memberId', memberId, asyncHandler(async (req, res) => ok(res, await members.getMember(req.params.memberId))));

adminRouter.patch(
  '/members/:memberId',
  memberId,
  validate({ body: schemas.updateMemberSchema }),
  asyncHandler(async (req, res) =>
    ok(res, await members.updateMember(req.params.memberId, req.body, req.user!.id, clientIp(req))),
  ),
);

adminRouter.get('/members/:memberId/fees', memberId, asyncHandler(async (req, res) => ok(res, await members.getMemberFees(req.params.memberId))));
adminRouter.get('/members/:memberId/payments', memberId, asyncHandler(async (req, res) => ok(res, await members.getMemberPayments(req.params.memberId))));
adminRouter.post('/members/:memberId/resend-invite', memberId, asyncHandler(async (req, res) => ok(res, await members.resendInvite(req.params.memberId))));

adminRouter.patch(
  '/members/:memberId/profile-image',
  memberId,
  imageUpload,
  asyncHandler(async (req, res) => {
    const m = await prisma.membership.findUnique({ where: { id: req.params.memberId }, include: { user: true } });
    if (!m?.user) throw notFound('Member not found');
    const name = await saveProfileImage(req.file);
    await prisma.user.update({ where: { id: m.user.id }, data: { profileImage: name } });
    await deleteProfileImage(m.user.profileImage);
    await audit({ actorId: req.user!.id, action: 'member.profile_image', entityType: 'Membership', entityId: m.id, ip: clientIp(req) });
    ok(res, { profileImageUrl: profileImageUrl(name) });
  }),
);

// ---------------------------------------------------------------- fees & payments
const feeId = validate({ params: uuidParam('feeId') });

adminRouter.get(
  '/fees',
  validate({ query: schemas.listFeesQuery }),
  asyncHandler(async (req, res) => {
    const q = req.query as any;
    const { items, total } = await fees.listFees(q);
    paginated(res, items, q.page, q.limit, total);
  }),
);

for (const [path, status] of [['/fees/pending', 'PENDING'], ['/fees/paid', 'PAID']] as const) {
  adminRouter.get(
    path,
    validate({ query: schemas.listFeesQuery }),
    asyncHandler(async (req, res) => {
      const q = { ...(req.query as any), status };
      const { items, total } = await fees.listFees(q);
      paginated(res, items, q.page, q.limit, total);
    }),
  );
}

adminRouter.patch(
  '/fees/:feeId/mark-paid',
  feeId,
  validate({ body: schemas.markPaidSchema }),
  asyncHandler(async (req, res) => ok(res, await markFeePaid(req.params.feeId, req.user!.id, req.body, clientIp(req)))),
);

adminRouter.patch(
  '/fees/:feeId/correct-payment',
  feeId,
  validate({ body: schemas.correctPaymentSchema }),
  asyncHandler(async (req, res) => ok(res, await correctPayment(req.params.feeId, req.user!.id, req.body, clientIp(req)))),
);

adminRouter.get(
  '/payments',
  validate({ query: schemas.paginationQuery }),
  asyncHandler(async (req, res) => {
    const q = req.query as any;
    const { items, total } = await fees.listPayments(q);
    paginated(res, items, q.page, q.limit, total);
  }),
);

// Manual recovery / catch-up for the monthly billing job.
adminRouter.post(
  '/billing/generate',
  asyncHandler(async (req, res) => {
    const result = await generateMissingFees();
    await audit({ actorId: req.user!.id, action: 'billing.generate', entityType: 'Billing', metadata: { ...result, upTo: `-` }, ip: clientIp(req) });
    ok(res, result);
  }),
);

// ---------------------------------------------------------------- member payment screenshots
adminRouter.get(
  '/proofs',
  validate({ query: schemas.listProofsQuery }),
  asyncHandler(async (req, res) => {
    const q = req.query as any;
    const { items, total } = await listProofs(q);
    paginated(res, items, q.page, q.limit, total);
  }),
);

adminRouter.get(
  '/proofs/:id/image',
  validate({ params: uuidParam('id') }),
  asyncHandler(async (req, res) => {
    const file = await getProofFile(req.params.id);
    res.set({ 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' });
    res.sendFile(proofImageFile(file));
  }),
);

adminRouter.patch(
  '/proofs/:id/approve',
  validate({ params: uuidParam('id'), body: schemas.approveProofSchema }),
  asyncHandler(async (req, res) => ok(res, await approveProof(req.params.id, req.user!.id, req.body, clientIp(req)))),
);

adminRouter.patch(
  '/proofs/:id/reject',
  validate({ params: uuidParam('id'), body: schemas.rejectProofSchema }),
  asyncHandler(async (req, res) => ok(res, await rejectProof(req.params.id, req.user!.id, req.body.reason, clientIp(req)))),
);

// Badge counts for the admin sidebar.
adminRouter.get(
  '/notifications',
  asyncHandler(async (_req, res) => {
    const [pendingProofs, pendingSignups] = await Promise.all([
      pendingProofCount(),
      prisma.user.count({ where: { role: 'MEMBER', membership: null, status: 'ACTIVE' } }),
    ]);
    ok(res, { pendingProofs, pendingSignups });
  }),
);

// Paid vs unpaid members per month, for the dashboard chart.
adminRouter.get(
  '/dashboard/monthly',
  validate({ query: z.object({ months: z.coerce.number().int().min(3).max(24).default(12) }) }),
  asyncHandler(async (req, res) => ok(res, await fees.monthlyBreakdown((req.query as any).months))),
);

adminRouter.use(contentAdminRouter);



