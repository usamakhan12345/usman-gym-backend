"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.todayDateOnly = exports.resumeBillingDate = exports.feeDueDate = exports.billingStartDate = void 0;
exports.firstBillingMonth = firstBillingMonth;
exports.displayStatus = displayStatus;
exports.generateFeesForMembership = generateFeesForMembership;
exports.generateMissingFees = generateMissingFees;
const env_1 = require("../../config/env");
const prisma_1 = require("../../lib/prisma");
const dates_1 = require("../../lib/dates");
Object.defineProperty(exports, "todayDateOnly", { enumerable: true, get: function () { return dates_1.todayDateOnly; } });
/** First billing month for a joining date, according to BILLING_LATE_JOIN_POLICY. Never prorated. */
function firstBillingMonth(joinedOn) {
    const joined = { year: joinedOn.getUTCFullYear(), month: joinedOn.getUTCMonth() + 1 };
    return env_1.env.BILLING_LATE_JOIN_POLICY === 'NEXT_MONTH' ? (0, dates_1.addMonths)(joined, 1) : joined;
}
const billingStartDate = (joinedOn) => {
    const { year, month } = firstBillingMonth(joinedOn);
    return (0, dates_1.dateOnly)(year, month, 1);
};
exports.billingStartDate = billingStartDate;
/** The fee is due on the 1st of its billing month; it is OVERDUE after OVERDUE_GRACE_DAYS. */
const feeDueDate = (year, month) => (0, dates_1.dateOnly)(year, month, 1);
exports.feeDueDate = feeDueDate;
function displayStatus(fee, now = new Date()) {
    if (fee.status === 'PAID')
        return 'PAID';
    const today = (0, dates_1.nowInAppTz)(now);
    const monthsLate = (today.year - fee.billingYear) * 12 + (today.month - fee.billingMonth);
    if (monthsLate > 0)
        return 'OVERDUE';
    if (monthsLate === 0 && today.day > env_1.env.OVERDUE_GRACE_DAYS)
        return 'OVERDUE';
    return 'PENDING';
}
/**
 * Creates every missing monthly fee for one membership, from its billing start up to `upTo`
 * (default: the current month in APP_TIMEZONE). Idempotent: existing months are never touched and
 * the unique (membershipId, billingYear, billingMonth) constraint + ON CONFLICT DO NOTHING make
 * concurrent runs safe. Because it fills *all* missing months, a missed scheduled run self-heals.
 */
async function generateFeesForMembership(membership, db = prisma_1.prisma, upTo = (0, dates_1.currentYearMonth)()) {
    if (membership.status !== 'ACTIVE')
        return 0;
    const start = { year: membership.billingStartsOn.getUTCFullYear(), month: membership.billingStartsOn.getUTCMonth() + 1 };
    if ((0, dates_1.compareYm)(start, upTo) > 0)
        return 0;
    const data = (0, dates_1.monthsBetween)(start, upTo).map(({ year, month }) => ({
        membershipId: membership.id,
        billingYear: year,
        billingMonth: month,
        amount: membership.monthlyFee,
        dueDate: (0, exports.feeDueDate)(year, month),
    }));
    const result = await db.monthlyFee.createMany({ data, skipDuplicates: true });
    return result.count;
}
/** Generates missing fees for all ACTIVE memberships. Safe to run any number of times. */
async function generateMissingFees(upTo = (0, dates_1.currentYearMonth)()) {
    let feesCreated = 0;
    let membershipsChecked = 0;
    let cursor;
    for (;;) {
        const batch = await prisma_1.prisma.membership.findMany({
            where: { status: 'ACTIVE', billingStartsOn: { lte: (0, dates_1.dateOnly)(upTo.year, upTo.month, 1) } },
            orderBy: { id: 'asc' },
            take: 200,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });
        if (batch.length === 0)
            break;
        for (const m of batch) {
            feesCreated += await generateFeesForMembership(m, prisma_1.prisma, upTo);
            membershipsChecked++;
        }
        cursor = batch[batch.length - 1].id;
    }
    return { membershipsChecked, feesCreated, upTo };
}
/** When a membership is (re)activated, billing resumes from the current month so inactive months are not back-billed. */
const resumeBillingDate = () => {
    const { year, month } = (0, dates_1.currentYearMonth)();
    return (0, dates_1.dateOnly)(year, month, 1);
};
exports.resumeBillingDate = resumeBillingDate;
