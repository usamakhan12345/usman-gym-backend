"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.memberRouter = void 0;
const express_1 = require("express");
const http_1 = require("../../lib/http");
const errors_1 = require("../../lib/errors");
const audit_1 = require("../../lib/audit");
const dates_1 = require("../../lib/dates");
const prisma_1 = require("../../lib/prisma");
const upload_1 = require("../../lib/upload");
const errors_2 = require("../../lib/errors");
const content_service_1 = require("../content/content.service");
const proofs_service_1 = require("../billing/proofs.service");
const auth_1 = require("../../middleware/auth");
const billing_dto_1 = require("../billing/billing.dto");
const billing_service_1 = require("../billing/billing.service");
const zod_1 = require("zod");
exports.memberRouter = (0, express_1.Router)();
exports.memberRouter.use(auth_1.memberOnly);
/**
 * Every query below is scoped by the membership linked to the *authenticated* user.
 * No member id is ever read from the request, so there is nothing to tamper with.
 */
exports.memberRouter.use((0, http_1.asyncHandler)(async (req, _res, next) => {
    const membership = await prisma_1.prisma.membership.findUnique({ where: { userId: req.user.id }, include: { plan: true } });
    if (!membership) {
        throw (0, errors_1.forbidden)('Your account is not linked to a gym membership yet. Please contact the gym admin.', 'NO_MEMBERSHIP');
    }
    req.membership = membership;
    next();
}));
const membershipOf = (req) => req.membership;
const membershipDto = (req) => {
    const m = membershipOf(req);
    return {
        gymId: m.gymId,
        fullName: m.fullName,
        phone: m.phone,
        email: m.email,
        joinedOn: (0, dates_1.ymd)(m.joinedOn),
        monthlyFee: m.monthlyFee.toString(),
        plan: m.plan ? m.plan.name : null,
        status: m.status,
    };
};
exports.memberRouter.get('/profile', (0, http_1.asyncHandler)(async (req, res) => {
    (0, http_1.ok)(res, { ...membershipDto(req), profileImageUrl: (0, upload_1.profileImageUrl)(req.user.profileImage) });
}));
exports.memberRouter.get('/membership', (0, http_1.asyncHandler)(async (req, res) => (0, http_1.ok)(res, membershipDto(req))));
/**
 * The ONLY writable member field is the profile picture. The upload parser rejects any extra
 * form fields (fields: 0), so attempts to send name/phone/fee/etc. fail with 400.
 */
exports.memberRouter.patch('/profile-image', upload_1.imageUpload, (0, http_1.asyncHandler)(async (req, res) => {
    const name = await (0, upload_1.saveProfileImage)(req.file);
    const previous = req.user.profileImage;
    await prisma_1.prisma.user.update({ where: { id: req.user.id }, data: { profileImage: name } });
    await (0, upload_1.deleteProfileImage)(previous);
    await (0, audit_1.audit)({ actorId: req.user.id, action: 'member.profile_image', entityType: 'User', entityId: req.user.id, ip: (0, http_1.clientIp)(req) });
    (0, http_1.ok)(res, { profileImageUrl: (0, upload_1.profileImageUrl)(name) });
}));
exports.memberRouter.get('/fees', (0, http_1.asyncHandler)(async (req, res) => {
    const m = membershipOf(req);
    // Self-heal if the scheduled job missed a run: the portal never shows a stale month.
    await (0, billing_service_1.generateFeesForMembership)(m);
    const fees = await prisma_1.prisma.monthlyFee.findMany({
        where: { membershipId: m.id },
        orderBy: [{ billingYear: 'desc' }, { billingMonth: 'desc' }],
        include: billing_dto_1.activePaymentInclude,
    });
    const proofs = await (0, proofs_service_1.latestProofsByFee)(m.id, fees.map((f) => f.id));
    const dto = fees.map((f) => ({ ...(0, billing_dto_1.feeDto)(f), proof: proofs.get(f.id) ?? null }));
    const outstanding = fees.filter((f) => f.status === 'PENDING');
    (0, http_1.ok)(res, {
        fees: dto,
        outstanding: {
            count: outstanding.length,
            amount: outstanding.reduce((s, f) => s + Number(f.amount), 0).toFixed(2),
        },
    });
}));
exports.memberRouter.get('/fees/current', (0, http_1.asyncHandler)(async (req, res) => {
    const m = membershipOf(req);
    await (0, billing_service_1.generateFeesForMembership)(m);
    const { year, month } = (0, dates_1.currentYearMonth)();
    const [current, pending, lastPayment] = await Promise.all([
        prisma_1.prisma.monthlyFee.findUnique({
            where: { membershipId_billingYear_billingMonth: { membershipId: m.id, billingYear: year, billingMonth: month } },
            include: billing_dto_1.activePaymentInclude,
        }),
        prisma_1.prisma.monthlyFee.aggregate({ where: { membershipId: m.id, status: 'PENDING' }, _sum: { amount: true }, _count: true }),
        prisma_1.prisma.payment.findFirst({
            where: { membershipId: m.id, status: 'ACTIVE' },
            orderBy: [{ paidOn: 'desc' }, { createdAt: 'desc' }],
            include: { fee: { select: { billingYear: true, billingMonth: true } } },
        }),
    ]);
    res.set('Cache-Control', 'no-store');
    (0, http_1.ok)(res, {
        period: { year, month },
        // null when billing has not started yet for this member (e.g. NEXT_MONTH policy) or the membership is inactive
        currentFee: current ? (0, billing_dto_1.feeDto)(current) : null,
        outstanding: { count: pending._count, amount: (pending._sum.amount ?? 0).toString() },
        lastPayment: lastPayment
            ? { ...(0, billing_dto_1.paymentDto)(lastPayment), billingYear: lastPayment.fee.billingYear, billingMonth: lastPayment.fee.billingMonth }
            : null,
    });
}));
exports.memberRouter.get('/payments', (0, http_1.validate)({ query: zod_1.z.object({}).passthrough() }), (0, http_1.asyncHandler)(async (req, res) => {
    const payments = await prisma_1.prisma.payment.findMany({
        where: { membershipId: membershipOf(req).id, status: 'ACTIVE' }, // voided entries are admin-audit only
        orderBy: [{ paidOn: 'desc' }, { createdAt: 'desc' }],
        include: { recordedBy: { select: { fullName: true } }, fee: { select: { billingYear: true, billingMonth: true } } },
    });
    res.set('Cache-Control', 'no-store');
    (0, http_1.ok)(res, payments.map((p) => ({ ...(0, billing_dto_1.paymentDto)(p), recordedBy: undefined, billingYear: p.fee.billingYear, billingMonth: p.fee.billingMonth })));
}));
// ---------------------------------------------------------------- online payment screenshots
const proofBody = zod_1.z
    .object({
    method: zod_1.z.enum(['BANK_TRANSFER', 'OTHER']),
    reference: zod_1.z.string().trim().max(100).optional(),
    note: zod_1.z.string().trim().max(500).optional(),
})
    .strict();
/** Bank/wallet instructions the admin configured. Only visible to logged-in members, not on the public site. */
exports.memberRouter.get('/payment-info', (0, http_1.asyncHandler)(async (_req, res) => {
    const settings = await (0, content_service_1.getSettings)();
    (0, http_1.ok)(res, { instructions: settings.payment?.instructions ?? '' });
}));
exports.memberRouter.post('/fees/:feeId/proof', (0, http_1.validate)({ params: (0, http_1.uuidParam)('feeId') }), upload_1.proofUpload, (0, http_1.asyncHandler)(async (req, res) => {
    const parsed = proofBody.safeParse(req.body ?? {});
    if (!parsed.success)
        throw (0, errors_2.badRequest)('Validation failed', parsed.error.flatten().fieldErrors);
    (0, http_1.ok)(res, await (0, proofs_service_1.submitProof)(membershipOf(req), req.params.feeId, parsed.data, req.file, (0, http_1.clientIp)(req)), 201);
}));
exports.memberRouter.get('/proofs', (0, http_1.asyncHandler)(async (req, res) => (0, http_1.ok)(res, await (0, proofs_service_1.listMemberProofs)(membershipOf(req).id))));
exports.memberRouter.get('/proofs/:id/image', (0, http_1.validate)({ params: (0, http_1.uuidParam)('id') }), (0, http_1.asyncHandler)(async (req, res) => {
    const file = await (0, proofs_service_1.getProofFile)(req.params.id, membershipOf(req).id); // 404 unless it is THIS member's proof
    res.set({ 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' });
    res.sendFile((0, upload_1.proofImageFile)(file));
}));
