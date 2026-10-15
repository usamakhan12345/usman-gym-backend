import { MonthlyFee, Payment, Prisma, User } from '@prisma/client';
import { monthLabel, ymd } from '../../lib/dates';
import { displayStatus } from './billing.service';

export type FeeWithPayments = MonthlyFee & { payments?: (Payment & { recordedBy?: Pick<User, 'fullName'> | null })[] };

/** Include clause that loads only the active payment (the one that made the fee PAID). */
export const activePaymentInclude = {
  payments: {
    where: { status: 'ACTIVE' as const },
    take: 1,
    include: { recordedBy: { select: { fullName: true } } },
  },
} satisfies Prisma.MonthlyFeeInclude;

export const paymentDto = (p: Payment & { recordedBy?: Pick<User, 'fullName'> | null }) => ({
  id: p.id,
  feeId: p.feeId,
  amount: p.amount.toString(),
  paidOn: ymd(p.paidOn),
  method: p.method,
  reference: p.reference,
  note: p.note,
  status: p.status,
  recordedBy: p.recordedBy?.fullName ?? null,
  voidedAt: p.voidedAt,
  voidReason: p.voidReason,
  createdAt: p.createdAt,
});

export function feeDto(fee: FeeWithPayments, now?: Date) {
  const active = fee.payments?.find((p) => p.status === 'ACTIVE');
  return {
    id: fee.id,
    membershipId: fee.membershipId,
    billingYear: fee.billingYear,
    billingMonth: fee.billingMonth,
    label: monthLabel(fee.billingYear, fee.billingMonth),
    amount: fee.amount.toString(),
    status: displayStatus(fee, now),
    dueDate: ymd(fee.dueDate),
    paidAt: fee.paidAt,
    payment: active ? paymentDto(active) : null,
  };
}
