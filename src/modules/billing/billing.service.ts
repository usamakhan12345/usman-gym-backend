import { Membership, Prisma } from '@prisma/client';
import { env } from '../../config/env';
import { prisma, Tx } from '../../lib/prisma';
import {
  YearMonth,
  addMonths,
  compareYm,
  currentYearMonth,
  dateOnly,
  monthsBetween,
  nowInAppTz,
  todayDateOnly,
} from '../../lib/dates';

type Db = Tx | typeof prisma;

/** First billing month for a joining date, according to BILLING_LATE_JOIN_POLICY. Never prorated. */
export function firstBillingMonth(joinedOn: Date): YearMonth {
  const joined = { year: joinedOn.getUTCFullYear(), month: joinedOn.getUTCMonth() + 1 };
  return env.BILLING_LATE_JOIN_POLICY === 'NEXT_MONTH' ? addMonths(joined, 1) : joined;
}

export const billingStartDate = (joinedOn: Date) => {
  const { year, month } = firstBillingMonth(joinedOn);
  return dateOnly(year, month, 1);
};

/** The fee is due on the 1st of its billing month; it is OVERDUE after OVERDUE_GRACE_DAYS. */
export const feeDueDate = (year: number, month: number) => dateOnly(year, month, 1);

export type DisplayFeeStatus = 'PAID' | 'PENDING' | 'OVERDUE';

export function displayStatus(
  fee: { status: 'PENDING' | 'PAID'; billingYear: number; billingMonth: number },
  now: Date = new Date(),
): DisplayFeeStatus {
  if (fee.status === 'PAID') return 'PAID';
  const today = nowInAppTz(now);
  const monthsLate = (today.year - fee.billingYear) * 12 + (today.month - fee.billingMonth);
  if (monthsLate > 0) return 'OVERDUE';
  if (monthsLate === 0 && today.day > env.OVERDUE_GRACE_DAYS) return 'OVERDUE';
  return 'PENDING';
}

/**
 * Creates every missing monthly fee for one membership, from its billing start up to `upTo`
 * (default: the current month in APP_TIMEZONE). Idempotent: existing months are never touched and
 * the unique (membershipId, billingYear, billingMonth) constraint + ON CONFLICT DO NOTHING make
 * concurrent runs safe. Because it fills *all* missing months, a missed scheduled run self-heals.
 */
export async function generateFeesForMembership(
  membership: Pick<Membership, 'id' | 'monthlyFee' | 'billingStartsOn' | 'status'>,
  db: Db = prisma,
  upTo: YearMonth = currentYearMonth(),
): Promise<number> {
  if (membership.status !== 'ACTIVE') return 0;
  const start = { year: membership.billingStartsOn.getUTCFullYear(), month: membership.billingStartsOn.getUTCMonth() + 1 };
  if (compareYm(start, upTo) > 0) return 0;

  const data: Prisma.MonthlyFeeCreateManyInput[] = monthsBetween(start, upTo).map(({ year, month }) => ({
    membershipId: membership.id,
    billingYear: year,
    billingMonth: month,
    amount: membership.monthlyFee,
    dueDate: feeDueDate(year, month),
  }));
  const result = await db.monthlyFee.createMany({ data, skipDuplicates: true });
  return result.count;
}

export interface BillingRunResult {
  membershipsChecked: number;
  feesCreated: number;
  upTo: YearMonth;
}

/** Generates missing fees for all ACTIVE memberships. Safe to run any number of times. */
export async function generateMissingFees(upTo: YearMonth = currentYearMonth()): Promise<BillingRunResult> {
  let feesCreated = 0;
  let membershipsChecked = 0;
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.membership.findMany({
      where: { status: 'ACTIVE', billingStartsOn: { lte: dateOnly(upTo.year, upTo.month, 1) } },
      orderBy: { id: 'asc' },
      take: 200,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (batch.length === 0) break;
    for (const m of batch) {
      feesCreated += await generateFeesForMembership(m, prisma, upTo);
      membershipsChecked++;
    }
    cursor = batch[batch.length - 1].id;
  }
  return { membershipsChecked, feesCreated, upTo };
}

/** When a membership is (re)activated, billing resumes from the current month so inactive months are not back-billed. */
export const resumeBillingDate = () => {
  const { year, month } = currentYearMonth();
  return dateOnly(year, month, 1);
};

export { todayDateOnly };
