"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.memberSearchWhere = memberSearchWhere;
exports.createMember = createMember;
exports.resendInvite = resendInvite;
exports.listMembers = listMembers;
exports.getMember = getMember;
exports.getMemberFees = getMemberFees;
exports.getMemberPayments = getMemberPayments;
exports.listUnlinkedUsers = listUnlinkedUsers;
exports.updateMember = updateMember;
const env_1 = require("../../config/env");
const audit_1 = require("../../lib/audit");
const dates_1 = require("../../lib/dates");
const errors_1 = require("../../lib/errors");
const identity_1 = require("../../lib/identity");
const prisma_1 = require("../../lib/prisma");
const upload_1 = require("../../lib/upload");
const emailTemplates_1 = require("../../services/emailTemplates");
const messenger_1 = require("../../services/messenger");
const billing_dto_1 = require("../billing/billing.dto");
const billing_service_1 = require("../billing/billing.service");
// ---------------------------------------------------------------- helpers
/** "0300 123" and "+92300123" should both find +92300123xxxx: compare on the significant digits. */
function phoneFragment(search) {
    return (0, identity_1.normalizePhone)(search).replace(/^\+/, '').replace(/^0+/, '');
}
function memberSearchWhere(search) {
    const s = search?.trim();
    if (!s)
        return {};
    const or = [
        { gymId: { contains: s, mode: 'insensitive' } },
        { fullName: { contains: s, mode: 'insensitive' } },
    ];
    const frag = phoneFragment(s);
    if (/^\d{3,}$/.test(frag))
        or.push({ phone: { contains: frag } });
    return { OR: or };
}
/** Prisma filter for "has an overdue fee right now" (past months, or current month beyond the grace period). */
function overdueFeeWhere() {
    const { year, month, day } = (0, dates_1.nowInAppTz)();
    const or = [
        { billingYear: { lt: year } },
        { billingYear: year, billingMonth: { lt: month } },
    ];
    if (day > env_1.env.OVERDUE_GRACE_DAYS)
        or.push({ billingYear: year, billingMonth: month });
    return { status: 'PENDING', OR: or };
}
const memberDto = (m) => ({
    id: m.id,
    gymId: m.gymId,
    fullName: m.fullName,
    phone: m.phone,
    email: m.email,
    joinedOn: (0, dates_1.ymd)(m.joinedOn),
    billingStartsOn: (0, dates_1.ymd)(m.billingStartsOn),
    monthlyFee: m.monthlyFee.toString(),
    status: m.status,
    plan: m.plan ? { id: m.plan.id, name: m.plan.name } : null,
    accountStatus: m.user?.status ?? null,
    profileImageUrl: (0, upload_1.profileImageUrl)(m.user?.profileImage),
    createdAt: m.createdAt,
});
async function outstandingFor(membershipIds) {
    const rows = await prisma_1.prisma.monthlyFee.groupBy({
        by: ['membershipId'],
        where: { membershipId: { in: membershipIds }, status: 'PENDING' },
        _sum: { amount: true },
        _count: true,
    });
    return new Map(rows.map((r) => [r.membershipId, { amount: (r._sum.amount ?? 0).toString(), count: r._count }]));
}
/** Atomic, gap-free-enough sequence: a single INSERT .. ON CONFLICT DO UPDATE .. RETURNING cannot hand out the same value twice. */
async function nextGymId(tx) {
    const rows = await tx.$queryRaw `
    INSERT INTO "Counter" ("key", "value") VALUES ('gym_id', 1001)
    ON CONFLICT ("key") DO UPDATE SET "value" = "Counter"."value" + 1
    RETURNING "value"`;
    return `${env_1.env.GYM_ID_PREFIX}-${rows[0].value}`;
}
async function createMember(input, adminId, ip) {
    const email = input.email || null;
    const plan = input.planId ? await prisma_1.prisma.membershipPlan.findUnique({ where: { id: input.planId } }) : null;
    if (input.planId && !plan)
        throw (0, errors_1.badRequest)('Selected membership plan does not exist');
    const fee = input.monthlyFee ?? plan?.monthlyFee.toString();
    if (!fee)
        throw (0, errors_1.badRequest)('Provide a monthly fee or choose a plan that has one');
    const result = await prisma_1.prisma.$transaction(async (tx) => {
        const dupMembership = await tx.membership.findFirst({
            where: { OR: [{ phone: input.phone }, ...(email ? [{ email }] : [])] },
            select: { gymId: true, phone: true },
        });
        if (dupMembership) {
            throw (0, errors_1.conflict)(dupMembership.phone === input.phone
                ? `A member with this phone number already exists (${dupMembership.gymId})`
                : `A member with this email already exists (${dupMembership.gymId})`, 'DUPLICATE_MEMBER');
        }
        // A person who already self-registered (and has no membership yet) is linked by the admin creating
        // their membership — that is the admin "approval". Anything ambiguous is refused.
        const existingUsers = await tx.user.findMany({
            where: { OR: [{ phone: input.phone }, ...(email ? [{ email }] : [])] },
            include: { membership: { select: { id: true } } },
        });
        if (existingUsers.length > 1)
            throw (0, errors_1.conflict)('This phone and email belong to different accounts', 'DUPLICATE_ACCOUNT');
        let user;
        if (existingUsers.length === 1) {
            const u = existingUsers[0];
            if (u.role !== 'MEMBER' || u.membership)
                throw (0, errors_1.conflict)('An account with these contact details already exists', 'DUPLICATE_ACCOUNT');
            user = u;
        }
        else {
            user = await tx.user.create({
                data: { fullName: input.fullName, phone: input.phone, email, role: 'MEMBER', status: 'INVITED' },
            });
        }
        const gymId = await nextGymId(tx);
        const membership = await tx.membership.create({
            data: {
                gymId,
                userId: user.id,
                fullName: input.fullName,
                phone: input.phone,
                email,
                joinedOn: input.joinedOn,
                billingStartsOn: (0, billing_service_1.billingStartDate)(input.joinedOn),
                monthlyFee: fee,
                planId: plan?.id ?? null,
                status: input.status,
                createdById: adminId,
            },
            include: { plan: true, user: { select: { status: true, profileImage: true } } },
        });
        const feesCreated = await (0, billing_service_1.generateFeesForMembership)(membership, tx);
        await (0, audit_1.audit)({ actorId: adminId, action: 'member.create', entityType: 'Membership', entityId: membership.id, metadata: { gymId, feesCreated }, ip }, tx);
        return { membership, user, feesCreated };
    });
    const inviteSent = result.user.status === 'INVITED' ? await sendInvite(result.user, result.membership.gymId) : false;
    return { ...memberDto(result.membership), feesCreated: result.feesCreated, inviteSent };
}
/** Best-effort invitation message. Never contains a password: the member sets their own via OTP. */
async function sendInvite(user, gymId) {
    const target = (0, messenger_1.channelFor)(user);
    if (!target)
        return false;
    try {
        const email = (0, emailTemplates_1.inviteEmail)(gymId);
        await (0, messenger_1.deliver)(target.channel === 'EMAIL'
            ? { channel: 'EMAIL', to: target.to, subject: email.subject, text: email.text, html: email.html }
            : { channel: 'SMS', to: target.to, subject: email.subject, text: (0, emailTemplates_1.inviteSms)(gymId) });
        return true;
    }
    catch (err) {
        console.error('[invite] delivery failed', err);
        return false;
    }
}
async function resendInvite(memberId) {
    const m = await prisma_1.prisma.membership.findUnique({ where: { id: memberId }, include: { user: true } });
    if (!m)
        throw (0, errors_1.notFound)('Member not found');
    if (!m.user || m.user.status !== 'INVITED')
        throw (0, errors_1.conflict)('This member has already activated their account', 'ALREADY_ACTIVE');
    return { inviteSent: await sendInvite(m.user, m.gymId) };
}
// ---------------------------------------------------------------- read
async function listMembers(q) {
    const { year, month } = (0, dates_1.currentYearMonth)();
    const and = [memberSearchWhere(q.search)];
    if (q.status)
        and.push({ status: q.status });
    if (q.feeStatus === 'PAID')
        and.push({ fees: { some: { billingYear: year, billingMonth: month, status: 'PAID' } } });
    if (q.feeStatus === 'PENDING')
        and.push({ fees: { some: { billingYear: year, billingMonth: month, status: 'PENDING' } } });
    if (q.feeStatus === 'OVERDUE')
        and.push({ fees: { some: overdueFeeWhere() } });
    const where = { AND: and };
    const [total, rows] = await Promise.all([
        prisma_1.prisma.membership.count({ where }),
        prisma_1.prisma.membership.findMany({
            where,
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            skip: (q.page - 1) * q.limit,
            take: q.limit,
            include: {
                plan: true,
                user: { select: { status: true, profileImage: true } },
                fees: { where: { billingYear: year, billingMonth: month }, take: 1 },
            },
        }),
    ]);
    const outstanding = await outstandingFor(rows.map((r) => r.id));
    const items = rows.map((r) => ({
        ...memberDto(r),
        currentFee: r.fees[0]
            ? { id: r.fees[0].id, amount: r.fees[0].amount.toString(), status: (0, billing_service_1.displayStatus)(r.fees[0]), label: (0, dates_1.monthLabel)(year, month) }
            : null,
        outstanding: outstanding.get(r.id) ?? { amount: '0', count: 0 },
    }));
    return { items, total };
}
async function getMember(id) {
    const m = await prisma_1.prisma.membership.findUnique({
        where: { id },
        include: { plan: true, user: { select: { status: true, profileImage: true } } },
    });
    if (!m)
        throw (0, errors_1.notFound)('Member not found');
    const [outstanding, paidCount] = await Promise.all([
        outstandingFor([m.id]),
        prisma_1.prisma.monthlyFee.count({ where: { membershipId: m.id, status: 'PAID' } }),
    ]);
    const o = outstanding.get(m.id) ?? { amount: '0', count: 0 };
    return { ...memberDto(m), summary: { outstandingAmount: o.amount, pendingCount: o.count, paidCount } };
}
async function getMemberFees(id) {
    await assertMemberExists(id);
    const fees = await prisma_1.prisma.monthlyFee.findMany({
        where: { membershipId: id },
        orderBy: [{ billingYear: 'desc' }, { billingMonth: 'desc' }],
        include: billing_dto_1.activePaymentInclude,
    });
    return fees.map((f) => (0, billing_dto_1.feeDto)(f));
}
async function getMemberPayments(id) {
    await assertMemberExists(id);
    const payments = await prisma_1.prisma.payment.findMany({
        where: { membershipId: id },
        orderBy: { createdAt: 'desc' },
        include: { recordedBy: { select: { fullName: true } }, fee: { select: { billingYear: true, billingMonth: true } } },
    });
    return payments.map((p) => ({ ...(0, billing_dto_1.paymentDto)(p), billingYear: p.fee.billingYear, billingMonth: p.fee.billingMonth }));
}
async function assertMemberExists(id) {
    if (!(await prisma_1.prisma.membership.findUnique({ where: { id }, select: { id: true } })))
        throw (0, errors_1.notFound)('Member not found');
}
async function listUnlinkedUsers() {
    const users = await prisma_1.prisma.user.findMany({
        where: { role: 'MEMBER', membership: null, status: { in: ['ACTIVE', 'PENDING_VERIFICATION'] } },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, fullName: true, email: true, phone: true, status: true, createdAt: true },
    });
    return users;
}
// ---------------------------------------------------------------- update
async function updateMember(id, input, adminId, ip) {
    if (input.planId) {
        if (!(await prisma_1.prisma.membershipPlan.findUnique({ where: { id: input.planId }, select: { id: true } }))) {
            throw (0, errors_1.badRequest)('Selected membership plan does not exist');
        }
    }
    const email = input.email === '' ? null : input.email;
    await prisma_1.prisma.$transaction(async (tx) => {
        const current = await tx.membership.findUnique({ where: { id } });
        if (!current)
            throw (0, errors_1.notFound)('Member not found');
        if (current.status === 'TERMINATED' && input.status && input.status !== 'TERMINATED') {
            throw new errors_1.AppError(409, 'TERMINATED', 'A terminated membership cannot be reactivated. Create a new membership instead.');
        }
        const data = {};
        if (input.fullName !== undefined)
            data.fullName = input.fullName;
        if (input.phone !== undefined)
            data.phone = input.phone;
        if (email !== undefined)
            data.email = email;
        if (input.planId !== undefined)
            data.plan = input.planId ? { connect: { id: input.planId } } : { disconnect: true };
        if (input.status !== undefined)
            data.status = input.status;
        if (input.monthlyFee !== undefined)
            data.monthlyFee = input.monthlyFee;
        if (input.status === 'ACTIVE' && current.status !== 'ACTIVE') {
            const resume = (0, billing_service_1.resumeBillingDate)();
            if (resume > current.billingStartsOn)
                data.billingStartsOn = resume; // do not back-bill the inactive period
        }
        const updated = await tx.membership.update({ where: { id }, data });
        // Keep the login account's contact details in sync with the locked membership record.
        if (updated.userId && (input.fullName !== undefined || input.phone !== undefined || email !== undefined)) {
            await tx.user.update({
                where: { id: updated.userId },
                data: {
                    ...(input.fullName !== undefined && { fullName: input.fullName }),
                    ...(input.phone !== undefined && { phone: input.phone }),
                    ...(email !== undefined && { email }),
                },
            });
        }
        // Fee changes only affect months generated from now on. Existing fee rows keep their snapshot,
        // except the current month if (and only if) it is unpaid and the admin explicitly asked for it.
        if (input.monthlyFee !== undefined && input.applyToCurrentPending) {
            const { year, month } = (0, dates_1.currentYearMonth)();
            await tx.monthlyFee.updateMany({
                where: { membershipId: id, billingYear: year, billingMonth: month, status: 'PENDING' },
                data: { amount: input.monthlyFee },
            });
        }
        if (updated.status === 'ACTIVE')
            await (0, billing_service_1.generateFeesForMembership)(updated, tx);
        const changes = {};
        for (const [k, v] of Object.entries(input))
            changes[k] = v === undefined ? null : String(v);
        await (0, audit_1.audit)({
            actorId: adminId,
            action: 'member.update',
            entityType: 'Membership',
            entityId: id,
            metadata: { changes, previousFee: current.monthlyFee.toString(), previousStatus: current.status },
            ip,
        }, tx);
    });
    return getMember(id);
}
