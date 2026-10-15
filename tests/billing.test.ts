import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { addMonths, currentYearMonth, monthsBetween } from '../src/lib/dates';
import { generateMissingFees } from '../src/modules/billing/billing.service';
import { adminAgent, createActiveMember, createAdmin, firstOfMonth, newMemberPayload, resetDb, pad } from './helpers';

let admin: Awaited<ReturnType<typeof adminAgent>>;
const today = () => new Date().toISOString().slice(0, 10);

beforeEach(async () => {
  await resetDb();
  await createAdmin();
  admin = await adminAgent();
});

const feesOf = (membershipId: string) =>
  prisma.monthlyFee.findMany({ where: { membershipId }, orderBy: [{ billingYear: 'asc' }, { billingMonth: 'asc' }] });

describe('monthly fee generation', () => {
  it('creates a pending fee for every month from joining up to the current month', async () => {
    const m = (await admin.post('/api/admin/members').send(newMemberPayload({ joinedOn: firstOfMonth(-2) }))).body.data;
    const fees = await feesOf(m.id);
    const expected = monthsBetween(addMonths(currentYearMonth(), -2), currentYearMonth());
    expect(fees.map((f) => [f.billingYear, f.billingMonth])).toEqual(expected.map((e) => [e.year, e.month]));
    expect(fees.every((f) => f.status === 'PENDING' && f.amount.toString() === '3000')).toBe(true);
  });

  it('a late-month joiner is billed the full month by default (no silent proration)', async () => {
    const m = (await admin.post('/api/admin/members').send(newMemberPayload({ joinedOn: today() }))).body.data;
    const fees = await feesOf(m.id);
    expect(fees).toHaveLength(1);
    expect(fees[0].amount.toString()).toBe('3000');
  });

  it('a new month generates a new pending fee and keeps unpaid history unpaid', async () => {
    const m = (await admin.post('/api/admin/members').send(newMemberPayload({ joinedOn: firstOfMonth(0) }))).body.data;
    const next = addMonths(currentYearMonth(), 1);
    const run = await generateMissingFees(next);
    expect(run.feesCreated).toBeGreaterThanOrEqual(1);
    const fees = await feesOf(m.id);
    expect(fees).toHaveLength(2);
    expect(fees.every((f) => f.status === 'PENDING')).toBe(true);
  });

  it('re-running generation is idempotent (also when run concurrently)', async () => {
    const m = (await admin.post('/api/admin/members').send(newMemberPayload({ joinedOn: firstOfMonth(-1) }))).body.data;
    const next = addMonths(currentYearMonth(), 1);
    await Promise.all([generateMissingFees(next), generateMissingFees(next), generateMissingFees(next)]);
    const again = await generateMissingFees(next);
    expect(again.feesCreated).toBe(0);
    expect(await feesOf(m.id)).toHaveLength(3);
  });

  it('catches up every missed month after downtime', async () => {
    const m = (await admin.post('/api/admin/members').send(newMemberPayload({ joinedOn: firstOfMonth(0) }))).body.data;
    await generateMissingFees(addMonths(currentYearMonth(), 5)); // pretend the scheduler was down for 5 months
    expect(await feesOf(m.id)).toHaveLength(6);
  });

  it('the database itself rejects a duplicate (member, year, month)', async () => {
    const m = (await admin.post('/api/admin/members').send(newMemberPayload())).body.data;
    const fee = (await feesOf(m.id))[0];
    await expect(
      prisma.monthlyFee.create({
        data: { membershipId: m.id, billingYear: fee.billingYear, billingMonth: fee.billingMonth, amount: '1', dueDate: fee.dueDate },
      }),
    ).rejects.toThrow();
  });

  it('inactive / terminated memberships do not generate fees, and reactivation does not back-bill', async () => {
    const m = (await admin.post('/api/admin/members').send(newMemberPayload({ joinedOn: firstOfMonth(-3), status: 'INACTIVE' }))).body.data;
    expect(await feesOf(m.id)).toHaveLength(0);
    await generateMissingFees(addMonths(currentYearMonth(), 2));
    expect(await feesOf(m.id)).toHaveLength(0);

    await admin.patch(`/api/admin/members/${m.id}`).send({ status: 'ACTIVE' });
    const fees = await feesOf(m.id);
    expect(fees).toHaveLength(1); // current month only
    expect([fees[0].billingYear, fees[0].billingMonth]).toEqual([currentYearMonth().year, currentYearMonth().month]);

    await admin.patch(`/api/admin/members/${m.id}`).send({ status: 'TERMINATED' });
    const reactivate = await admin.patch(`/api/admin/members/${m.id}`).send({ status: 'ACTIVE' });
    expect(reactivate.status).toBe(409);
  });

  it('the manual recovery endpoint is admin-only and safe to repeat', async () => {
    const { agent } = await createActiveMember(admin);
    expect((await agent.post('/api/admin/billing/generate')).status).toBe(403);
    const r1 = await admin.post('/api/admin/billing/generate');
    const r2 = await admin.post('/api/admin/billing/generate');
    expect(r1.status).toBe(200);
    expect(r2.body.data.feesCreated).toBe(0);
  });
});

describe('marking fees paid', () => {
  const pay = (agent: typeof admin, feeId: string, over: object = {}) =>
    agent.patch(`/api/admin/fees/${feeId}/mark-paid`).send({ paymentDate: today(), method: 'CASH', ...over });

  it('marks exactly one month paid; other months stay pending and the member portal reflects it', async () => {
    const { member, agent } = await createActiveMember(admin, { joinedOn: firstOfMonth(-2) });
    const fees = await feesOf(member.id);
    expect(fees).toHaveLength(3);
    const target = fees[0]; // the oldest month

    const res = await pay(admin, target.id, { reference: 'TX-1', note: 'cash at desk' });
    expect(res.status).toBe(200);
    expect(res.body.data.fee.status).toBe('PAID');
    expect(res.body.data.payment.amount).toBe('3000');

    const after = await feesOf(member.id);
    expect(after.map((f) => f.status)).toEqual(['PAID', 'PENDING', 'PENDING']);

    // member portal sees the new state straight from the DB
    const portal = (await agent.get('/api/member/fees')).body.data;
    expect(portal.fees.filter((f: any) => f.status === 'PAID')).toHaveLength(1);
    expect(portal.outstanding.count).toBe(2);
    expect(portal.outstanding.amount).toBe('6000.00');
    const history = (await agent.get('/api/member/payments')).body.data;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ amount: '3000', method: 'CASH' });
  });

  it('a duplicate / double-submitted payment creates only one payment record', async () => {
    const { member } = await createActiveMember(admin);
    const fee = (await feesOf(member.id))[0];
    const [a, b, c] = await Promise.all([pay(admin, fee.id), pay(admin, fee.id), pay(admin, fee.id)]);
    const statuses = [a.status, b.status, c.status].sort();
    expect(statuses).toEqual([200, 409, 409]);
    expect(await prisma.payment.count({ where: { feeId: fee.id } })).toBe(1);
    expect((await pay(admin, fee.id)).body.error.code).toBe('ALREADY_PAID');
  });

  it('an idempotency key makes retries return the original payment', async () => {
    const { member } = await createActiveMember(admin);
    const fee = (await feesOf(member.id))[0];
    const first = await pay(admin, fee.id, { idempotencyKey: 'retry-key-0001' });
    const retry = await pay(admin, fee.id, { idempotencyKey: 'retry-key-0001' });
    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(retry.body.data.payment.id).toBe(first.body.data.payment.id);
    expect(await prisma.payment.count()).toBe(1);
  });

  it('does not let the admin alter the fee amount, or pay in the future', async () => {
    const { member } = await createActiveMember(admin);
    const fee = (await feesOf(member.id))[0];
    expect((await pay(admin, fee.id, { amount: '1' })).status).toBe(400); // unknown key rejected
    const future = `${currentYearMonth().year + 1}-01-01`;
    expect((await pay(admin, fee.id, { paymentDate: future })).status).toBe(400);
    expect((await feesOf(member.id))[0].status).toBe('PENDING');
  });

  it('returns proper errors for unknown / malformed fee ids', async () => {
    expect((await pay(admin, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await pay(admin, 'nope')).status).toBe(400);
  });

  it('preserves historical fee amounts when the monthly fee later changes', async () => {
    const { member } = await createActiveMember(admin, { joinedOn: firstOfMonth(-1) });
    const [older, current] = await feesOf(member.id);
    await pay(admin, older.id);
    await admin.patch(`/api/admin/members/${member.id}`).send({ monthlyFee: '5000' });
    await generateMissingFees(addMonths(currentYearMonth(), 1));
    const fees = await feesOf(member.id);
    expect(fees.map((f) => f.amount.toString())).toEqual(['3000', '3000', '5000']);
    expect(fees[0].status).toBe('PAID');
    expect(current.id).toBe(fees[1].id);

    // optionally re-price only the *current unpaid* month
    await admin.patch(`/api/admin/members/${member.id}`).send({ monthlyFee: '6000', applyToCurrentPending: true });
    const again = await feesOf(member.id);
    expect(again.map((f) => f.amount.toString())).toEqual(['3000', '6000', '5000']);
  });
});

describe('correcting payments', () => {
  it('voids a payment without deleting history, returning the fee to pending', async () => {
    const { member } = await createActiveMember(admin);
    const fee = (await feesOf(member.id))[0];
    await admin.patch(`/api/admin/fees/${fee.id}/mark-paid`).send({ paymentDate: today(), method: 'CASH' });

    const res = await admin.patch(`/api/admin/fees/${fee.id}/correct-payment`).send({ reason: 'Entered by mistake' });
    expect(res.status).toBe(200);
    expect(res.body.data.fee.status).not.toBe('PAID');

    const payments = await prisma.payment.findMany({ where: { feeId: fee.id } });
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ status: 'VOIDED', voidReason: 'Entered by mistake' });
    expect(payments[0].voidedById).not.toBeNull();

    // can be paid again after the correction, producing a second (active) record
    const again = await admin.patch(`/api/admin/fees/${fee.id}/mark-paid`).send({ paymentDate: today(), method: 'BANK_TRANSFER' });
    expect(again.status).toBe(200);
    expect(await prisma.payment.count({ where: { feeId: fee.id } })).toBe(2);
    expect(await prisma.payment.count({ where: { feeId: fee.id, status: 'ACTIVE' } })).toBe(1);
  });

  it('can replace a payment with corrected details in one step; unpaid fees cannot be corrected', async () => {
    const { member, agent } = await createActiveMember(admin);
    const fee = (await feesOf(member.id))[0];
    expect((await admin.patch(`/api/admin/fees/${fee.id}/correct-payment`).send({ reason: 'oops' })).status).toBe(409);

    await admin.patch(`/api/admin/fees/${fee.id}/mark-paid`).send({ paymentDate: today(), method: 'CASH' });
    const res = await admin
      .patch(`/api/admin/fees/${fee.id}/correct-payment`)
      .send({ reason: 'Wrong method', replacement: { paymentDate: today(), method: 'BANK_TRANSFER', reference: 'BT-9' } });
    expect(res.body.data.fee.status).toBe('PAID');
    expect(res.body.data.payment.method).toBe('BANK_TRANSFER');
    // member-facing history only shows the valid payment
    expect((await agent.get('/api/member/payments')).body.data).toHaveLength(1);
    // admin-facing history keeps both
    expect((await admin.get(`/api/admin/members/${member.id}/payments`)).body.data).toHaveLength(2);
  });

  it('writes audit log entries for sensitive actions', async () => {
    const { member } = await createActiveMember(admin);
    const fee = (await feesOf(member.id))[0];
    await admin.patch(`/api/admin/fees/${fee.id}/mark-paid`).send({ paymentDate: today(), method: 'CASH' });
    const actions = (await prisma.auditLog.findMany()).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['member.create', 'fee.mark_paid']));
  });
});

describe('member portal: current fee', () => {
  it('shows the current month status and outstanding balance from the app timezone', async () => {
    const { agent } = await createActiveMember(admin, { joinedOn: firstOfMonth(-1) });
    const res = (await agent.get('/api/member/fees/current')).body.data;
    const { year, month } = currentYearMonth();
    expect(res.period).toEqual({ year, month });
    expect(res.currentFee).toMatchObject({ billingYear: year, billingMonth: month, amount: '3000' });
    expect(['PENDING', 'OVERDUE']).toContain(res.currentFee.status);
    expect(res.outstanding).toMatchObject({ count: 2, amount: '6000' });
    expect(res.lastPayment).toBeNull();
  });

  it('older unpaid months are OVERDUE', async () => {
    const { agent } = await createActiveMember(admin, { joinedOn: firstOfMonth(-1) });
    const fees = (await agent.get('/api/member/fees')).body.data.fees;
    const prev = addMonths(currentYearMonth(), -1);
    const old = fees.find((f: any) => f.billingYear === prev.year && f.billingMonth === prev.month);
    expect(old.status).toBe('OVERDUE');
    void pad;
  });
});
