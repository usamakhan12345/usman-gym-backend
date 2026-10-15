import { Prisma } from '@prisma/client';
import { currentYearMonth, dateOnly, monthLabel, nowInAppTz } from '../../lib/dates';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { activePaymentInclude, feeDto, paymentDto } from '../billing/billing.dto';
import { memberSearchWhere } from './members.service';

export async function listFees(q: {
  search?: string;
  status?: 'PAID' | 'PENDING' | 'OVERDUE';
  year?: number;
  month?: number;
  page: number;
  limit: number;
}) {
  const where: Prisma.MonthlyFeeWhereInput = {
    ...(q.year && { billingYear: q.year }),
    ...(q.month && { billingMonth: q.month }),
    ...(q.search && { membership: memberSearchWhere(q.search) }),
  };
  if (q.status === 'PAID') where.status = 'PAID';
  if (q.status === 'PENDING') where.status = 'PENDING';
  if (q.status === 'OVERDUE') {
    const { year, month, day } = nowInAppTz();
    where.status = 'PENDING';
    where.AND = [
      {
        OR: [
          { billingYear: { lt: year } },
          { billingYear: year, billingMonth: { lt: month } },
          ...(day > env.OVERDUE_GRACE_DAYS ? [{ billingYear: year, billingMonth: month }] : []),
        ],
      },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.monthlyFee.count({ where }),
    prisma.monthlyFee.findMany({
      where,
      orderBy: [{ billingYear: 'desc' }, { billingMonth: 'desc' }, { membership: { fullName: 'asc' } }, { id: 'asc' }],
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      include: { ...activePaymentInclude, membership: { select: { id: true, gymId: true, fullName: true, phone: true } } },
    }),
  ]);
  return { items: rows.map((f) => ({ ...feeDto(f), member: f.membership })), total };
}

export async function listPayments(q: { search?: string; page: number; limit: number }) {
  const where: Prisma.PaymentWhereInput = q.search ? { membership: memberSearchWhere(q.search) } : {};
  const [total, rows] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      include: {
        recordedBy: { select: { fullName: true } },
        fee: { select: { billingYear: true, billingMonth: true } },
        membership: { select: { id: true, gymId: true, fullName: true } },
      },
    }),
  ]);
  return {
    items: rows.map((p) => ({
      ...paymentDto(p),
      billingYear: p.fee.billingYear,
      billingMonth: p.fee.billingMonth,
      member: p.membership,
    })),
    total,
  };
}

export async function dashboardStats() {
  const { year, month } = currentYearMonth();
  const monthStart = dateOnly(year, month, 1);
  const nextMonthStart = month === 12 ? dateOnly(year + 1, 1, 1) : dateOnly(year, month + 1, 1);

  const [total, active, newThisMonth, pendingAll, currentPending, currentPaid, collected, outstanding, recent, pendingSignups] =
    await Promise.all([
      prisma.membership.count(),
      prisma.membership.count({ where: { status: 'ACTIVE' } }),
      prisma.membership.count({ where: { joinedOn: { gte: monthStart, lt: nextMonthStart } } }),
      prisma.monthlyFee.count({ where: { status: 'PENDING' } }),
      prisma.monthlyFee.count({ where: { status: 'PENDING', billingYear: year, billingMonth: month } }),
      prisma.monthlyFee.count({ where: { status: 'PAID', billingYear: year, billingMonth: month } }),
      prisma.payment.aggregate({
        where: { status: 'ACTIVE', paidOn: { gte: monthStart, lt: nextMonthStart } },
        _sum: { amount: true },
      }),
      prisma.monthlyFee.aggregate({ where: { status: 'PENDING' }, _sum: { amount: true } }),
      prisma.payment.findMany({
        where: { status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
          recordedBy: { select: { fullName: true } },
          fee: { select: { billingYear: true, billingMonth: true } },
          membership: { select: { id: true, gymId: true, fullName: true } },
        },
      }),
      prisma.user.count({ where: { role: 'MEMBER', membership: null, status: 'ACTIVE' } }),
    ]);

  return {
    period: { year, month },
    totalMembers: total,
    activeMembers: active,
    newMembersThisMonth: newThisMonth,
    pendingFeeCount: pendingAll,
    currentMonthPendingCount: currentPending,
    paidFeeCountThisMonth: currentPaid,
    feesCollectedThisMonth: (collected._sum.amount ?? 0).toString(),
    totalOutstanding: (outstanding._sum.amount ?? 0).toString(),
    pendingSignups,
    recentPayments: recent.map((p) => ({
      ...paymentDto(p),
      billingYear: p.fee.billingYear,
      billingMonth: p.fee.billingMonth,
      member: p.membership,
    })),
  };
}

/**
 * Per-month totals of fee records: how many members were billed ("total"), how many of those are paid vs unpaid,
 * and the money. Status is as of now, so a member who pays an old month later moves that month's bar from unpaid to paid.
 */
export async function monthlyBreakdown(months: number) {
  const end = currentYearMonth();
  const startIdx = end.year * 12 + (end.month - 1) - (months - 1);
  const endIdx = end.year * 12 + (end.month - 1);

  const rows = await prisma.$queryRaw<{ y: number; m: number; s: 'PENDING' | 'PAID'; c: number; a: string }[]>`
    SELECT "billingYear" AS y, "billingMonth" AS m, "status"::text AS s, COUNT(*)::int AS c, COALESCE(SUM("amount"), 0)::text AS a
    FROM "MonthlyFee"
    WHERE ("billingYear" * 12 + ("billingMonth" - 1)) BETWEEN ${startIdx} AND ${endIdx}
    GROUP BY 1, 2, 3`;

  const byKey = new Map<string, { paid: number; unpaid: number; paidAmount: number; unpaidAmount: number }>();
  for (const r of rows) {
    const k = `${r.y}-${r.m}`;
    const e = byKey.get(k) ?? { paid: 0, unpaid: 0, paidAmount: 0, unpaidAmount: 0 };
    if (r.s === 'PAID') { e.paid += r.c; e.paidAmount += Number(r.a); } else { e.unpaid += r.c; e.unpaidAmount += Number(r.a); }
    byKey.set(k, e);
  }

  const out = [];
  for (let idx = startIdx; idx <= endIdx; idx++) {
    const year = Math.floor(idx / 12);
    const month = (idx % 12) + 1;
    const e = byKey.get(`${year}-${month}`) ?? { paid: 0, unpaid: 0, paidAmount: 0, unpaidAmount: 0 };
    out.push({
      year,
      month,
      label: monthLabel(year, month),
      total: e.paid + e.unpaid,
      paid: e.paid,
      unpaid: e.unpaid,
      paidAmount: e.paidAmount.toFixed(2),
      unpaidAmount: e.unpaidAmount.toFixed(2),
    });
  }
  return out;
}
