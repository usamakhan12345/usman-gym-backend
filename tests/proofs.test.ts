import fs from 'fs';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { addMonths, currentYearMonth } from '../src/lib/dates';
import { outbox } from '../src/services/messenger';
import { ADMIN, app, adminAgent, createActiveMember, createAdmin, firstOfMonth, resetDb } from './helpers';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const today = () => new Date().toISOString().slice(0, 10);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let admin: Awaited<ReturnType<typeof adminAgent>>;
type Agent = Awaited<ReturnType<typeof createActiveMember>>['agent'];

beforeEach(async () => {
  await resetDb();
  await prisma.$executeRawUnsafe('TRUNCATE "PaymentProof" CASCADE');
  await createAdmin();
  admin = await adminAgent();
});
afterAll(() => fs.rmSync('uploads-test', { recursive: true, force: true }));

const feesOf = (membershipId: string) =>
  prisma.monthlyFee.findMany({ where: { membershipId }, orderBy: [{ billingYear: 'asc' }, { billingMonth: 'asc' }] });

const upload = (agent: Agent, feeId: string, fields: Record<string, string> = {}, file: Buffer | null = PNG) => {
  let r = agent.post(`/api/member/fees/${feeId}/proof`).field('method', fields.method ?? 'BANK_TRANSFER');
  for (const [k, v] of Object.entries(fields)) if (k !== 'method') r = r.field(k, v);
  return file ? r.attach('image', file, 'shot.png') : r;
};

describe('member uploads a payment screenshot', () => {
  it('creates a pending proof, does NOT change the fee, and notifies the admin', async () => {
    const { member, agent } = await createActiveMember(admin, { joinedOn: firstOfMonth(-1) });
    const fee = (await feesOf(member.id))[0];
    const res = await upload(agent, fee.id, { reference: 'TX-1001', note: 'paid via bank app' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'PENDING', method: 'BANK_TRANSFER', reference: 'TX-1001' });

    expect((await feesOf(member.id))[0].status).toBe('PENDING'); // nothing is paid until the admin approves
    await wait(300);
    expect(outbox.some((m) => m.to === ADMIN.email && /screenshot/i.test(m.subject))).toBe(true);

    const list = (await admin.get('/api/admin/proofs').query({ status: 'PENDING' })).body;
    expect(list.data).toHaveLength(1);
    expect(list.data[0].member.fullName).toBe(member.fullName);
    expect((await admin.get('/api/admin/notifications')).body.data.pendingProofs).toBe(1);

    const fees = (await agent.get('/api/member/fees')).body.data.fees;
    expect(fees.find((f: any) => f.id === fee.id).proof.status).toBe('PENDING');
  });

  it('allows only one pending screenshot per month', async () => {
    const { member, agent } = await createActiveMember(admin);
    const fee = (await feesOf(member.id))[0];
    expect((await upload(agent, fee.id)).status).toBe(201);
    const again = await upload(agent, fee.id);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('PROOF_PENDING');
    expect(await prisma.paymentProof.count()).toBe(1);
  });

  it('validates the file and fields', async () => {
    const { member, agent } = await createActiveMember(admin);
    const fee = (await feesOf(member.id))[0];
    expect((await upload(agent, fee.id, {}, null)).status).toBe(400); // no file
    expect((await upload(agent, fee.id, {}, Buffer.from('<script>alert(1)</script>'))).status).toBe(400); // not an image
    expect((await upload(agent, fee.id, {}, Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]))).status).toBe(400); // too big
    expect((await upload(agent, fee.id, { method: 'CASH' })).status).toBe(400); // cash is recorded by the admin
    expect((await upload(agent, fee.id, { amount: '1' })).status).toBe(400); // unknown field
    expect(await prisma.paymentProof.count()).toBe(0);
  });

  it('cannot target another member fee or an already paid fee', async () => {
    const a = await createActiveMember(admin);
    const b = await createActiveMember(admin);
    const feeA = (await feesOf(a.member.id))[0];
    expect((await upload(b.agent, feeA.id)).status).toBe(404);

    await admin.patch(`/api/admin/fees/${feeA.id}/mark-paid`).send({ paymentDate: today(), method: 'CASH' });
    const paid = await upload(a.agent, feeA.id);
    expect(paid.status).toBe(409);
    expect(paid.body.error.code).toBe('ALREADY_PAID');
    expect((await request(app).post(`/api/member/fees/${feeA.id}/proof`)).status).toBe(401);
  });

  it('screenshots are private: only the owner and admins can open them', async () => {
    const a = await createActiveMember(admin);
    const b = await createActiveMember(admin);
    const fee = (await feesOf(a.member.id))[0];
    const proof = (await upload(a.agent, fee.id)).body.data;

    const own = await a.agent.get(`/api/member/proofs/${proof.id}/image`);
    expect(own.status).toBe(200);
    expect(own.headers['content-type']).toMatch(/image\/png/);
    expect((await admin.get(`/api/admin/proofs/${proof.id}/image`)).status).toBe(200);
    expect((await b.agent.get(`/api/member/proofs/${proof.id}/image`)).status).toBe(404);
    expect((await b.agent.get(`/api/admin/proofs/${proof.id}/image`)).status).toBe(403);
    expect((await request(app).get(`/api/member/proofs/${proof.id}/image`)).status).toBe(401);
    expect((await request(app).get('/uploads/proofs/anything.png')).status).toBe(404); // never served statically
  });
});

describe('admin reviews a screenshot', () => {
  it('approving marks exactly that month paid, links the payment, and cannot be repeated', async () => {
    const { member, agent } = await createActiveMember(admin, { joinedOn: firstOfMonth(-2) });
    const fees = await feesOf(member.id);
    const proof = (await upload(agent, fees[0].id, { reference: 'TX-7' })).body.data;

    const res = await admin.patch(`/api/admin/proofs/${proof.id}/approve`).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('APPROVED');

    expect((await feesOf(member.id)).map((f) => f.status)).toEqual(['PAID', 'PENDING', 'PENDING']);
    const payment = await prisma.payment.findFirstOrThrow({ where: { feeId: fees[0].id } });
    expect(payment).toMatchObject({ status: 'ACTIVE', method: 'BANK_TRANSFER', reference: 'TX-7' });
    expect(payment.amount.toString()).toBe('3000'); // always the fee's own amount
    expect((await prisma.paymentProof.findUniqueOrThrow({ where: { id: proof.id } })).paymentId).toBe(payment.id);

    expect((await admin.patch(`/api/admin/proofs/${proof.id}/approve`).send({})).status).toBe(409);
    expect(await prisma.payment.count({ where: { feeId: fees[0].id } })).toBe(1);

    await wait(300);
    expect(outbox.some((m) => m.to === member.email && /confirmed/i.test(m.subject))).toBe(true);
  });

  it('rejecting keeps the fee unpaid, records the reason, and lets the member upload again', async () => {
    const { member, agent } = await createActiveMember(admin);
    const fee = (await feesOf(member.id))[0];
    const proof = (await upload(agent, fee.id)).body.data;

    expect((await admin.patch(`/api/admin/proofs/${proof.id}/reject`).send({})).status).toBe(400); // reason required
    const res = await admin.patch(`/api/admin/proofs/${proof.id}/reject`).send({ reason: 'Screenshot is blurry' });
    expect(res.body.data).toMatchObject({ status: 'REJECTED', rejectReason: 'Screenshot is blurry' });
    expect((await feesOf(member.id))[0].status).toBe('PENDING');
    expect(await prisma.payment.count()).toBe(0);

    const seen = (await agent.get('/api/member/fees')).body.data.fees.find((f: any) => f.id === fee.id).proof;
    expect(seen).toMatchObject({ status: 'REJECTED', rejectReason: 'Screenshot is blurry' });

    expect((await upload(agent, fee.id, { reference: 'TX-2' })).status).toBe(201); // resubmission allowed
  });

  it('approval fails safely if the fee was paid another way in the meantime', async () => {
    const { member, agent } = await createActiveMember(admin);
    const fee = (await feesOf(member.id))[0];
    const proof = (await upload(agent, fee.id)).body.data;
    await admin.patch(`/api/admin/fees/${fee.id}/mark-paid`).send({ paymentDate: today(), method: 'CASH' });

    const res = await admin.patch(`/api/admin/proofs/${proof.id}/approve`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_PAID');
    expect((await prisma.paymentProof.findUniqueOrThrow({ where: { id: proof.id } })).status).toBe('PENDING'); // rolled back
    expect(await prisma.payment.count({ where: { feeId: fee.id } })).toBe(1);
  });

  it('only admins can review', async () => {
    const { member, agent } = await createActiveMember(admin);
    const fee = (await feesOf(member.id))[0];
    const proof = (await upload(agent, fee.id)).body.data;
    expect((await agent.patch(`/api/admin/proofs/${proof.id}/approve`).send({})).status).toBe(403);
    expect((await agent.patch(`/api/admin/proofs/${proof.id}/reject`).send({ reason: 'nope' })).status).toBe(403);
    expect((await agent.get('/api/admin/proofs')).status).toBe(403);
    expect((await admin.patch('/api/admin/proofs/00000000-0000-4000-8000-000000000000/approve').send({})).status).toBe(404);
  });
});

describe('monthly paid / unpaid chart data', () => {
  it('reports total, paid and unpaid members per month and changes as payments are made', async () => {
    const a = await createActiveMember(admin, { joinedOn: firstOfMonth(-1) });
    const b = await createActiveMember(admin, { joinedOn: firstOfMonth(0) });
    const cur = currentYearMonth();
    const prev = addMonths(cur, -1);
    const find = (d: any[], ym: { year: number; month: number }) => d.find((x) => x.year === ym.year && x.month === ym.month);

    let data = (await admin.get('/api/admin/dashboard/monthly').query({ months: 3 })).body.data;
    expect(data).toHaveLength(3);
    expect(find(data, cur)).toMatchObject({ total: 2, paid: 0, unpaid: 2 });
    expect(find(data, prev)).toMatchObject({ total: 1, paid: 0, unpaid: 1 });
    expect(find(data, addMonths(cur, -2))).toMatchObject({ total: 0, paid: 0, unpaid: 0 });

    const feeB = (await feesOf(b.member.id))[0];
    await admin.patch(`/api/admin/fees/${feeB.id}/mark-paid`).send({ paymentDate: today(), method: 'CASH' });
    data = (await admin.get('/api/admin/dashboard/monthly').query({ months: 3 })).body.data;
    expect(find(data, cur)).toMatchObject({ total: 2, paid: 1, unpaid: 1, paidAmount: '3000.00', unpaidAmount: '3000.00' });

    expect((await admin.get('/api/admin/dashboard/monthly').query({ months: 99 })).status).toBe(400);
    expect((await a.agent.get('/api/admin/dashboard/monthly')).status).toBe(403);
  });
});
