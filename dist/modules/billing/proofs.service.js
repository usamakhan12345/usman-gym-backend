"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pendingProofCount = exports.proofDto = void 0;
exports.submitProof = submitProof;
exports.listMemberProofs = listMemberProofs;
exports.latestProofsByFee = latestProofsByFee;
exports.getProofFile = getProofFile;
exports.listProofs = listProofs;
exports.approveProof = approveProof;
exports.rejectProof = rejectProof;
const client_1 = require("@prisma/client");
const audit_1 = require("../../lib/audit");
const dates_1 = require("../../lib/dates");
const errors_1 = require("../../lib/errors");
const prisma_1 = require("../../lib/prisma");
const upload_1 = require("../../lib/upload");
const emailTemplates_1 = require("../../services/emailTemplates");
const messenger_1 = require("../../services/messenger");
const payments_service_1 = require("./payments.service");
// ---------------------------------------------------------------- notifications (best effort, never block the request)
async function sendEmailTo(user, email) {
    const target = (0, messenger_1.channelFor)(user);
    if (!target || target.channel !== 'EMAIL')
        return; // proof notifications are email only
    try {
        await (0, messenger_1.deliver)({ channel: 'EMAIL', to: target.to, subject: email.subject, text: email.text, html: email.html });
    }
    catch (err) {
        console.error('[proof] notification failed', err);
    }
}
async function notifyAdmins(email) {
    const admins = await prisma_1.prisma.user.findMany({ where: { role: 'ADMIN', status: 'ACTIVE' }, select: { id: true, email: true, phone: true } });
    await Promise.all(admins.map((a) => sendEmailTo(a, email)));
}
// ---------------------------------------------------------------- DTOs
const proofSelect = {
    fee: { select: { billingYear: true, billingMonth: true, amount: true, status: true } },
    membership: { select: { id: true, gymId: true, fullName: true, phone: true } },
    reviewedBy: { select: { fullName: true } },
};
const proofDto = (p, viewer) => ({
    id: p.id,
    feeId: p.feeId,
    status: p.status,
    method: p.method,
    reference: p.reference,
    note: p.note,
    rejectReason: p.rejectReason,
    createdAt: p.createdAt,
    reviewedAt: p.reviewedAt,
    billingYear: p.fee.billingYear,
    billingMonth: p.fee.billingMonth,
    label: (0, dates_1.monthLabel)(p.fee.billingYear, p.fee.billingMonth),
    amount: p.fee.amount.toString(),
    feeStatus: p.fee.status,
    imageUrl: `/api/${viewer}/proofs/${p.id}/image`,
    ...(viewer === 'admin' ? { member: p.membership, reviewedBy: p.reviewedBy?.fullName ?? null } : {}),
});
exports.proofDto = proofDto;
// ---------------------------------------------------------------- member side
async function submitProof(member, feeId, input, file, ip) {
    // Ownership is part of the query: another member's fee id simply "does not exist" for this member.
    const fee = await prisma_1.prisma.monthlyFee.findFirst({ where: { id: feeId, membershipId: member.id } });
    if (!fee)
        throw (0, errors_1.notFound)('Fee record not found');
    if (fee.status === 'PAID')
        throw new errors_1.AppError(409, 'ALREADY_PAID', 'This month is already paid');
    if (await prisma_1.prisma.paymentProof.findFirst({ where: { feeId, status: 'PENDING' }, select: { id: true } })) {
        throw (0, errors_1.conflict)('You already submitted a screenshot for this month. It is waiting for admin review.', 'PROOF_PENDING');
    }
    const imageFile = await (0, upload_1.saveProofImage)(file); // validates the real image type and size
    let proof;
    try {
        proof = await prisma_1.prisma.$transaction(async (tx) => {
            const created = await tx.paymentProof.create({
                data: { feeId, membershipId: member.id, imageFile, method: input.method, reference: input.reference || null, note: input.note || null },
                include: proofSelect,
            });
            await (0, audit_1.audit)({ actorId: null, action: 'proof.submit', entityType: 'PaymentProof', entityId: created.id, metadata: { feeId, membershipId: member.id }, ip }, tx);
            return created;
        });
    }
    catch (e) {
        await (0, upload_1.deleteProofImage)(imageFile); // do not leave orphan files behind
        if (e instanceof client_1.Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            throw (0, errors_1.conflict)('You already submitted a screenshot for this month. It is waiting for admin review.', 'PROOF_PENDING');
        }
        throw e;
    }
    void notifyAdmins((0, emailTemplates_1.notificationEmail)({
        subject: `New payment screenshot from ${member.fullName}`,
        title: 'Payment screenshot received',
        intro: `${member.fullName} (${member.gymId}) uploaded a payment screenshot. Please review it and update their fee status.`,
        rows: [
            ['Member', member.fullName],
            ['Gym ID', member.gymId],
            ['Month', (0, dates_1.monthLabel)(fee.billingYear, fee.billingMonth)],
            ['Amount', `Rs. ${Number(fee.amount).toLocaleString('en-PK')}`],
        ],
        cta: { label: 'Review screenshot', path: '/admin/payment-proofs' },
    }));
    return (0, exports.proofDto)(proof, 'member');
}
async function listMemberProofs(membershipId) {
    const rows = await prisma_1.prisma.paymentProof.findMany({ where: { membershipId }, orderBy: { createdAt: 'desc' }, include: proofSelect });
    return rows.map((r) => (0, exports.proofDto)(r, 'member'));
}
/** Latest proof per fee, used to decorate the member's fee list. */
async function latestProofsByFee(membershipId, feeIds) {
    const rows = await prisma_1.prisma.paymentProof.findMany({
        where: { membershipId, feeId: { in: feeIds } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, feeId: true, status: true, rejectReason: true, createdAt: true },
    });
    const map = new Map();
    for (const r of rows)
        if (!map.has(r.feeId))
            map.set(r.feeId, r); // rows are newest-first
    return map;
}
async function getProofFile(proofId, ownerMembershipId) {
    const proof = await prisma_1.prisma.paymentProof.findFirst({ where: { id: proofId, ...(ownerMembershipId ? { membershipId: ownerMembershipId } : {}) } });
    if (!proof)
        throw (0, errors_1.notFound)('Screenshot not found');
    return proof.imageFile;
}
// ---------------------------------------------------------------- admin side
async function listProofs(q) {
    const where = {
        ...(q.status && { status: q.status }),
        ...(q.search && {
            membership: {
                OR: [
                    { gymId: { contains: q.search, mode: 'insensitive' } },
                    { fullName: { contains: q.search, mode: 'insensitive' } },
                    { phone: { contains: q.search } },
                ],
            },
        }),
    };
    const [total, rows] = await Promise.all([
        prisma_1.prisma.paymentProof.count({ where }),
        prisma_1.prisma.paymentProof.findMany({
            where,
            // Oldest pending first so nobody waits forever; reviewed ones newest first.
            orderBy: { createdAt: q.status === 'PENDING' ? 'asc' : 'desc' },
            skip: (q.page - 1) * q.limit,
            take: q.limit,
            include: proofSelect,
        }),
    ]);
    return { items: rows.map((r) => (0, exports.proofDto)(r, 'admin')), total };
}
const pendingProofCount = () => prisma_1.prisma.paymentProof.count({ where: { status: 'PENDING' } });
exports.pendingProofCount = pendingProofCount;
/**
 * Approving a screenshot = recording the payment. The proof claim, fee PENDING->PAID, payment row and
 * audit entries commit together; if the fee was meanwhile paid another way the whole thing rolls back (409).
 */
async function approveProof(proofId, adminId, override, ip) {
    const paymentDate = override.paymentDate ?? (0, dates_1.todayDateOnly)();
    if (paymentDate.getTime() > (0, dates_1.todayDateOnly)().getTime())
        throw (0, errors_1.badRequest)('Payment date cannot be in the future');
    const result = await prisma_1.prisma.$transaction(async (tx) => {
        const proof = await tx.paymentProof.findUnique({ where: { id: proofId }, include: proofSelect });
        if (!proof)
            throw (0, errors_1.notFound)('Screenshot not found');
        const claimed = await tx.paymentProof.updateMany({
            where: { id: proofId, status: 'PENDING' },
            data: { status: 'APPROVED', reviewedById: adminId, reviewedAt: new Date() },
        });
        if (claimed.count !== 1)
            throw new errors_1.AppError(409, 'ALREADY_REVIEWED', 'This screenshot has already been reviewed');
        const input = {
            paymentDate,
            method: override.method ?? proof.method,
            reference: override.reference ?? proof.reference,
            note: override.note ?? proof.note ?? 'Approved from member screenshot',
        };
        const paymentId = await (0, payments_service_1.payFeeInTx)(tx, proof.feeId, adminId, input, null, ip);
        await tx.paymentProof.update({ where: { id: proofId }, data: { paymentId } });
        await (0, audit_1.audit)({ actorId: adminId, action: 'proof.approve', entityType: 'PaymentProof', entityId: proofId, metadata: { paymentId, feeId: proof.feeId }, ip }, tx);
        return { proof, paymentId };
    });
    const member = await prisma_1.prisma.membership.findUnique({ where: { id: result.proof.membershipId }, include: { user: true } });
    if (member?.user) {
        void sendEmailTo(member.user, (0, emailTemplates_1.notificationEmail)({
            subject: 'Your payment has been confirmed',
            title: 'Payment confirmed',
            intro: `Thank you! The gym has checked your screenshot and marked ${(0, dates_1.monthLabel)(result.proof.fee.billingYear, result.proof.fee.billingMonth)} as paid.`,
            rows: [['Month', (0, dates_1.monthLabel)(result.proof.fee.billingYear, result.proof.fee.billingMonth)], ['Amount', `Rs. ${Number(result.proof.fee.amount).toLocaleString('en-PK')}`], ['Paid on', (0, dates_1.ymd)(paymentDate)]],
            cta: { label: 'View my fees', path: '/member/fees' },
        }));
    }
    return getProofDto(proofId);
}
async function rejectProof(proofId, adminId, reason, ip) {
    const proof = await prisma_1.prisma.$transaction(async (tx) => {
        const found = await tx.paymentProof.findUnique({ where: { id: proofId }, include: proofSelect });
        if (!found)
            throw (0, errors_1.notFound)('Screenshot not found');
        const claimed = await tx.paymentProof.updateMany({
            where: { id: proofId, status: 'PENDING' },
            data: { status: 'REJECTED', reviewedById: adminId, reviewedAt: new Date(), rejectReason: reason },
        });
        if (claimed.count !== 1)
            throw new errors_1.AppError(409, 'ALREADY_REVIEWED', 'This screenshot has already been reviewed');
        await (0, audit_1.audit)({ actorId: adminId, action: 'proof.reject', entityType: 'PaymentProof', entityId: proofId, metadata: { reason }, ip }, tx);
        return found;
    });
    const member = await prisma_1.prisma.membership.findUnique({ where: { id: proof.membershipId }, include: { user: true } });
    if (member?.user) {
        void sendEmailTo(member.user, (0, emailTemplates_1.notificationEmail)({
            subject: 'Your payment screenshot could not be accepted',
            title: 'Screenshot not accepted',
            intro: `We could not confirm your payment for ${(0, dates_1.monthLabel)(proof.fee.billingYear, proof.fee.billingMonth)}. Your fee is still unpaid.`,
            note: { text: `Reason: ${reason}`, tone: 'danger' },
            cta: { label: 'Upload again', path: '/member/fees' },
        }));
    }
    return getProofDto(proofId);
}
async function getProofDto(id) {
    const p = await prisma_1.prisma.paymentProof.findUniqueOrThrow({ where: { id }, include: proofSelect });
    return (0, exports.proofDto)(p, 'admin');
}
