"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertPaymentDateNotFuture = void 0;
exports.payFeeInTx = payFeeInTx;
exports.markFeePaid = markFeePaid;
exports.correctPayment = correctPayment;
const client_1 = require("@prisma/client");
const audit_1 = require("../../lib/audit");
const dates_1 = require("../../lib/dates");
const errors_1 = require("../../lib/errors");
const prisma_1 = require("../../lib/prisma");
const billing_dto_1 = require("./billing.dto");
const assertNotFuture = (d) => {
    if (d.getTime() > (0, dates_1.todayDateOnly)().getTime())
        throw (0, errors_1.badRequest)('Payment date cannot be in the future');
};
async function writePayment(tx, fee, adminId, input, key) {
    return tx.payment.create({
        data: {
            feeId: fee.id,
            membershipId: fee.membershipId,
            amount: fee.amount, // always the fee's own snapshot — the admin cannot alter it here
            paidOn: input.paymentDate,
            method: input.method,
            reference: input.reference || null,
            note: input.note || null,
            idempotencyKey: key || null,
            recordedById: adminId,
        },
    });
}
/**
 * Transactional core shared by "mark paid" and "approve payment proof".
 * Flips exactly one fee PENDING -> PAID with a conditional UPDATE (two simultaneous requests can never both
 * succeed), then writes the payment row and audit entry. Must run inside a transaction.
 */
async function payFeeInTx(tx, feeId, adminId, input, key, ip) {
    const fee = await tx.monthlyFee.findUnique({ where: { id: feeId } });
    if (!fee)
        throw (0, errors_1.notFound)('Fee record not found');
    const claimed = await tx.monthlyFee.updateMany({
        where: { id: feeId, status: 'PENDING' },
        data: { status: 'PAID', paidAt: new Date() },
    });
    if (claimed.count !== 1)
        throw new errors_1.AppError(409, 'ALREADY_PAID', 'This month is already marked as paid');
    const payment = await writePayment(tx, fee, adminId, input, key);
    await (0, audit_1.audit)({
        actorId: adminId,
        action: 'fee.mark_paid',
        entityType: 'MonthlyFee',
        entityId: feeId,
        metadata: { paymentId: payment.id, amount: fee.amount.toString(), method: input.method },
        ip,
    }, tx);
    return payment.id;
}
exports.assertPaymentDateNotFuture = assertNotFuture;
/**
 * Marks exactly one monthly fee as paid.
 *  - The PENDING -> PAID transition is a single conditional UPDATE, so two simultaneous requests
 *    can never both succeed (no duplicate payments); the loser gets 409 ALREADY_PAID.
 *  - An optional idempotencyKey makes client retries return the original result.
 *  - Fee status change, payment row and audit entry commit together or not at all.
 */
async function markFeePaid(feeId, adminId, input, ip) {
    assertNotFuture(input.paymentDate);
    if (input.idempotencyKey) {
        const prior = await prisma_1.prisma.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
        if (prior) {
            if (prior.feeId !== feeId)
                throw (0, errors_1.conflict)('This idempotency key was already used for another fee', 'IDEMPOTENCY_KEY_REUSED');
            return loadResult(feeId, prior.id);
        }
    }
    try {
        const paymentId = await prisma_1.prisma.$transaction((tx) => payFeeInTx(tx, feeId, adminId, input, input.idempotencyKey, ip));
        return loadResult(feeId, paymentId);
    }
    catch (e) {
        // Lost a race on the same idempotency key: return the winner's result.
        if (e instanceof client_1.Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && input.idempotencyKey) {
            const prior = await prisma_1.prisma.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
            if (prior && prior.feeId === feeId)
                return loadResult(feeId, prior.id);
        }
        throw e;
    }
}
/**
 * Corrects a mistaken payment without deleting history: the active payment is VOIDED (kept, with who/when/why)
 * and the fee either returns to PENDING or is re-paid with corrected details.
 */
async function correctPayment(feeId, adminId, input, ip) {
    if (input.replacement)
        assertNotFuture(input.replacement.paymentDate);
    const paymentId = await prisma_1.prisma.$transaction(async (tx) => {
        const fee = await tx.monthlyFee.findUnique({ where: { id: feeId } });
        if (!fee)
            throw (0, errors_1.notFound)('Fee record not found');
        const voided = await tx.payment.updateMany({
            where: { feeId, status: 'ACTIVE' },
            data: { status: 'VOIDED', voidedAt: new Date(), voidedById: adminId, voidReason: input.reason },
        });
        if (voided.count !== 1)
            throw new errors_1.AppError(409, 'NOT_PAID', 'This fee has no active payment to correct');
        let newPaymentId = null;
        if (input.replacement) {
            const p = await writePayment(tx, fee, adminId, input.replacement);
            newPaymentId = p.id;
            await tx.monthlyFee.update({ where: { id: feeId }, data: { status: 'PAID', paidAt: new Date() } });
        }
        else {
            await tx.monthlyFee.update({ where: { id: feeId }, data: { status: 'PENDING', paidAt: null } });
        }
        await (0, audit_1.audit)({
            actorId: adminId,
            action: input.replacement ? 'fee.payment_replaced' : 'fee.payment_voided',
            entityType: 'MonthlyFee',
            entityId: feeId,
            metadata: { reason: input.reason, newPaymentId },
            ip,
        }, tx);
        return newPaymentId;
    });
    return loadResult(feeId, paymentId);
}
async function loadResult(feeId, paymentId) {
    const fee = await prisma_1.prisma.monthlyFee.findUniqueOrThrow({
        where: { id: feeId },
        include: { ...billing_dto_1.activePaymentInclude, membership: { select: { id: true, gymId: true, fullName: true } } },
    });
    const payment = paymentId
        ? await prisma_1.prisma.payment.findUnique({ where: { id: paymentId }, include: { recordedBy: { select: { fullName: true } } } })
        : null;
    return { fee: { ...(0, billing_dto_1.feeDto)(fee), member: fee.membership }, payment: payment ? (0, billing_dto_1.paymentDto)(payment) : null };
}
