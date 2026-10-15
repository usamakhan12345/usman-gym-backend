import { PaymentMethod, Prisma } from '@prisma/client';
import { audit } from '../../lib/audit';
import { todayDateOnly } from '../../lib/dates';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors';
import { prisma, Tx } from '../../lib/prisma';
import { activePaymentInclude, feeDto, paymentDto } from './billing.dto';

export interface PaymentInput {
  paymentDate: Date;
  method: PaymentMethod;
  reference?: string | null;
  note?: string | null;
}

const assertNotFuture = (d: Date) => {
  if (d.getTime() > todayDateOnly().getTime()) throw badRequest('Payment date cannot be in the future');
};

async function writePayment(tx: Tx, fee: { id: string; membershipId: string; amount: Prisma.Decimal }, adminId: string, input: PaymentInput, key?: string | null) {
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
export async function payFeeInTx(tx: Tx, feeId: string, adminId: string, input: PaymentInput, key?: string | null, ip?: string) {
  const fee = await tx.monthlyFee.findUnique({ where: { id: feeId } });
  if (!fee) throw notFound('Fee record not found');

  const claimed = await tx.monthlyFee.updateMany({
    where: { id: feeId, status: 'PENDING' },
    data: { status: 'PAID', paidAt: new Date() },
  });
  if (claimed.count !== 1) throw new AppError(409, 'ALREADY_PAID', 'This month is already marked as paid');

  const payment = await writePayment(tx, fee, adminId, input, key);
  await audit(
    {
      actorId: adminId,
      action: 'fee.mark_paid',
      entityType: 'MonthlyFee',
      entityId: feeId,
      metadata: { paymentId: payment.id, amount: fee.amount.toString(), method: input.method },
      ip,
    },
    tx,
  );
  return payment.id;
}

export const assertPaymentDateNotFuture = assertNotFuture;

/**
 * Marks exactly one monthly fee as paid.
 *  - The PENDING -> PAID transition is a single conditional UPDATE, so two simultaneous requests
 *    can never both succeed (no duplicate payments); the loser gets 409 ALREADY_PAID.
 *  - An optional idempotencyKey makes client retries return the original result.
 *  - Fee status change, payment row and audit entry commit together or not at all.
 */
export async function markFeePaid(
  feeId: string,
  adminId: string,
  input: PaymentInput & { idempotencyKey?: string },
  ip?: string,
) {
  assertNotFuture(input.paymentDate);

  if (input.idempotencyKey) {
    const prior = await prisma.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (prior) {
      if (prior.feeId !== feeId) throw conflict('This idempotency key was already used for another fee', 'IDEMPOTENCY_KEY_REUSED');
      return loadResult(feeId, prior.id);
    }
  }

  try {
    const paymentId = await prisma.$transaction((tx) => payFeeInTx(tx, feeId, adminId, input, input.idempotencyKey, ip));
    return loadResult(feeId, paymentId);
  } catch (e) {
    // Lost a race on the same idempotency key: return the winner's result.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && input.idempotencyKey) {
      const prior = await prisma.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (prior && prior.feeId === feeId) return loadResult(feeId, prior.id);
    }
    throw e;
  }
}

/**
 * Corrects a mistaken payment without deleting history: the active payment is VOIDED (kept, with who/when/why)
 * and the fee either returns to PENDING or is re-paid with corrected details.
 */
export async function correctPayment(
  feeId: string,
  adminId: string,
  input: { reason: string; replacement?: PaymentInput },
  ip?: string,
) {
  if (input.replacement) assertNotFuture(input.replacement.paymentDate);

  const paymentId = await prisma.$transaction(async (tx) => {
    const fee = await tx.monthlyFee.findUnique({ where: { id: feeId } });
    if (!fee) throw notFound('Fee record not found');

    const voided = await tx.payment.updateMany({
      where: { feeId, status: 'ACTIVE' },
      data: { status: 'VOIDED', voidedAt: new Date(), voidedById: adminId, voidReason: input.reason },
    });
    if (voided.count !== 1) throw new AppError(409, 'NOT_PAID', 'This fee has no active payment to correct');

    let newPaymentId: string | null = null;
    if (input.replacement) {
      const p = await writePayment(tx, fee, adminId, input.replacement);
      newPaymentId = p.id;
      await tx.monthlyFee.update({ where: { id: feeId }, data: { status: 'PAID', paidAt: new Date() } });
    } else {
      await tx.monthlyFee.update({ where: { id: feeId }, data: { status: 'PENDING', paidAt: null } });
    }
    await audit(
      {
        actorId: adminId,
        action: input.replacement ? 'fee.payment_replaced' : 'fee.payment_voided',
        entityType: 'MonthlyFee',
        entityId: feeId,
        metadata: { reason: input.reason, newPaymentId },
        ip,
      },
      tx,
    );
    return newPaymentId;
  });
  return loadResult(feeId, paymentId);
}

async function loadResult(feeId: string, paymentId: string | null) {
  const fee = await prisma.monthlyFee.findUniqueOrThrow({
    where: { id: feeId },
    include: { ...activePaymentInclude, membership: { select: { id: true, gymId: true, fullName: true } } },
  });
  const payment = paymentId
    ? await prisma.payment.findUnique({ where: { id: paymentId }, include: { recordedBy: { select: { fullName: true } } } })
    : null;
  return { fee: { ...feeDto(fee), member: fee.membership }, payment: payment ? paymentDto(payment) : null };
}
