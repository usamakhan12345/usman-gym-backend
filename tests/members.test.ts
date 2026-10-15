import fs from 'fs';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { app, adminAgent, createActiveMember, createAdmin, lastOtp, loginAs, newMemberPayload, resetDb } from './helpers';

// 1x1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let admin: Awaited<ReturnType<typeof adminAgent>>;
beforeEach(async () => {
  await resetDb();
  await createAdmin();
  admin = await adminAgent();
});

describe('admin adds members', () => {
  it('creates a member with a generated unique Gym ID and an invited (password-less) account', async () => {
    const p = newMemberPayload();
    const res = await admin.post('/api/admin/members').send(p);
    expect(res.status).toBe(201);
    expect(res.body.data.gymId).toMatch(/^UG-\d{4,}$/);
    expect(res.body.data).not.toHaveProperty('passwordHash');
    const user = await prisma.user.findUniqueOrThrow({ where: { phone: p.phone } });
    expect(user.status).toBe('INVITED');
    expect(user.passwordHash).toBeNull(); // no predictable password is ever assigned
  });

  it('never hands out the same Gym ID, even under concurrent creation', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => admin.post('/api/admin/members').send(newMemberPayload())));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const ids = results.map((r) => r.body.data.gymId);
    expect(new Set(ids).size).toBe(12);
  });

  it('prevents duplicate members by phone or email', async () => {
    const p = newMemberPayload();
    expect((await admin.post('/api/admin/members').send(p)).status).toBe(201);
    const dupPhone = await admin.post('/api/admin/members').send({ ...p, email: 'other@test.local' });
    const dupEmail = await admin.post('/api/admin/members').send({ ...p, phone: '+923009999999' });
    expect(dupPhone.status).toBe(409);
    expect(dupEmail.status).toBe(409);
  });

  it('validates phone, fee and date', async () => {
    const bad = await admin.post('/api/admin/members').send({ ...newMemberPayload(), phone: '12', monthlyFee: '-5', joinedOn: '2026-02-31' });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.details)).toEqual(expect.arrayContaining(['phone', 'monthlyFee', 'joinedOn']));
  });

  it('non-admins cannot add members', async () => {
    const { agent } = await createActiveMember(admin);
    expect((await agent.post('/api/admin/members').send(newMemberPayload())).status).toBe(403);
    expect((await request(app).post('/api/admin/members').send(newMemberPayload())).status).toBe(401);
  });

  it('uses the plan fee when none is given', async () => {
    const plan = await prisma.membershipPlan.create({ data: { name: 'Gold', monthlyFee: '4500', features: [] } });
    const { monthlyFee: _omit, ...rest } = newMemberPayload();
    const res = await admin.post('/api/admin/members').send({ ...rest, planId: plan.id });
    expect(res.body.data.monthlyFee).toBe('4500');
  });
});

describe('self-registered sign-ups', () => {
  it('shows up for the admin, and creating the membership links that same login', async () => {
    const signup = { fullName: 'Walk In', email: 'walkin@test.local', phone: '+923004440001', password: 'WalkIn12345' };
    await request(app).post('/api/auth/register').send(signup);
    await request(app).post('/api/auth/verify-otp').send({ identifier: signup.email, purpose: 'SIGNUP', code: lastOtp(signup.email) });
    const user = await loginAs(signup.email, signup.password);
    expect((await user.get('/api/auth/me')).body.data.accountState).toBe('MEMBER_UNLINKED');

    // visible to the admin (and counted on the dashboard)
    const waiting = (await admin.get('/api/admin/members/unlinked-users')).body.data;
    expect(waiting.map((u: any) => u.email)).toContain(signup.email);
    expect((await admin.get('/api/admin/dashboard/stats')).body.data.pendingSignups).toBe(1);

    // admin creates the membership => the existing login is linked (no second account is made)
    const created = await admin.post('/api/admin/members').send(newMemberPayload({ fullName: signup.fullName, phone: signup.phone, email: signup.email }));
    expect(created.status).toBe(201);
    expect(await prisma.user.count({ where: { phone: signup.phone } })).toBe(1);

    const me = (await user.get('/api/auth/me')).body.data;
    expect(me.accountState).toBe('MEMBER_ACTIVE');
    expect(me.membership.gymId).toBe(created.body.data.gymId);
    expect((await user.get('/api/member/fees/current')).status).toBe(200);
    expect((await admin.get('/api/admin/members/unlinked-users')).body.data).toHaveLength(0);
  });
});

describe('admin searches members', () => {
  it('finds by Gym ID, name and (formatted or partial) phone', async () => {
    const a = (await admin.post('/api/admin/members').send(newMemberPayload({ fullName: 'Ahmed Raza', phone: '+923121234567' }))).body.data;
    await admin.post('/api/admin/members').send(newMemberPayload({ fullName: 'Ahmed Ali', phone: '+923217654321' }));
    await admin.post('/api/admin/members').send(newMemberPayload({ fullName: 'Bilal Shah', phone: '+923331112222' }));

    const byId = await admin.get('/api/admin/members').query({ search: a.gymId.toLowerCase() });
    expect(byId.body.data.map((m: any) => m.gymId)).toEqual([a.gymId]);

    const byName = await admin.get('/api/admin/members').query({ search: 'ahmed' });
    expect(byName.body.data).toHaveLength(2); // similar names return all matches
    expect(byName.body.meta.total).toBe(2);

    const byPhone = await admin.get('/api/admin/members').query({ search: '0312 123' });
    expect(byPhone.body.data.map((m: any) => m.fullName)).toEqual(['Ahmed Raza']);
  });

  it('paginates', async () => {
    for (let i = 0; i < 5; i++) await admin.post('/api/admin/members').send(newMemberPayload());
    const p1 = await admin.get('/api/admin/members').query({ limit: 2, page: 1 });
    const p3 = await admin.get('/api/admin/members').query({ limit: 2, page: 3 });
    expect(p1.body.data).toHaveLength(2);
    expect(p3.body.data).toHaveLength(1);
    expect(p1.body.meta).toMatchObject({ total: 5, totalPages: 3 });
  });
});

describe('members cannot change locked data', () => {
  it('rejects profile edits except the picture, and accepts a valid image', async () => {
    const { agent, member } = await createActiveMember(admin);

    // There is no endpoint to edit locked fields, and the image endpoint refuses extra fields.
    expect((await agent.patch('/api/member/profile').send({ fullName: 'Hacker' })).status).toBe(404);
    expect((await agent.patch('/api/member/membership').send({ monthlyFee: '1' })).status).toBe(404);
    const withExtra = await agent.patch('/api/member/profile-image').field('monthlyFee', '1').attach('image', PNG, 'a.png');
    expect(withExtra.status).toBe(400);
    // members can't call the admin update either
    expect((await agent.patch(`/api/admin/members/${member.id}`).send({ monthlyFee: '1' })).status).toBe(403);

    const ok = await agent.patch('/api/member/profile-image').attach('image', PNG, 'avatar.png');
    expect(ok.status).toBe(200);
    expect(ok.body.data.profileImageUrl).toMatch(/^\/uploads\/profiles\/[0-9a-f-]+\.png$/);

    const profile = await agent.get('/api/member/profile');
    expect(profile.body.data.fullName).toBe(member.fullName);
    expect(profile.body.data.monthlyFee).toBe('3000');
    expect(profile.body.data.gymId).toBe(member.gymId);

    // cleanup stored file
    const user = await prisma.user.findFirstOrThrow({ where: { profileImage: { not: null } } });
    fs.rmSync(`uploads/profiles/${user.profileImage}`, { force: true });
  });

  it('rejects non-images and oversized files even if labelled as images', async () => {
    const { agent } = await createActiveMember(admin);
    const fake = await agent.patch('/api/member/profile-image').attach('image', Buffer.from('<script>alert(1)</script>'), { filename: 'x.png', contentType: 'image/png' });
    expect(fake.status).toBe(400);
    const big = await agent.patch('/api/member/profile-image').attach('image', Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)]), 'big.png');
    expect(big.status).toBe(400);
  });

  it('a member only ever sees their own records', async () => {
    const a = await createActiveMember(admin);
    const b = await createActiveMember(admin);
    const fa = (await a.agent.get('/api/member/fees')).body.data.fees;
    const fb = (await b.agent.get('/api/member/fees')).body.data.fees;
    expect(fa.length).toBeGreaterThan(0);
    const idsA = new Set(fa.map((f: any) => f.id));
    expect(fb.some((f: any) => idsA.has(f.id))).toBe(false);
    expect((await a.agent.get('/api/member/profile')).body.data.gymId).toBe(a.member.gymId);
    expect((await b.agent.get('/api/member/profile')).body.data.gymId).toBe(b.member.gymId);
    // member cannot reach another member's admin endpoints by id
    expect((await a.agent.get(`/api/admin/members/${b.member.id}/fees`)).status).toBe(403);
    // and cannot mark a fee paid
    expect((await a.agent.patch(`/api/admin/fees/${fa[0].id}/mark-paid`).send({ paymentDate: '2026-01-01', method: 'CASH' })).status).toBe(403);
  });
});

describe('admin updates members', () => {
  it('changes contact info and keeps the login account in sync; fee change does not touch history', async () => {
    const m = (await admin.post('/api/admin/members').send(newMemberPayload({ joinedOn: '2020-01-01' }))).body.data;
    const before = await prisma.monthlyFee.findMany({ where: { membershipId: m.id } });
    const res = await admin.patch(`/api/admin/members/${m.id}`).send({ fullName: 'New Name', monthlyFee: '3500' });
    expect(res.status).toBe(200);
    expect(res.body.data.monthlyFee).toBe('3500');
    const user = await prisma.user.findFirstOrThrow({ where: { membership: { id: m.id } } });
    expect(user.fullName).toBe('New Name');
    const after = await prisma.monthlyFee.findMany({ where: { membershipId: m.id } });
    expect(after.every((f) => f.amount.toString() === '3000')).toBe(true);
    expect(after).toHaveLength(before.length);
  });

  it('returns 404 / 400 for bad ids', async () => {
    expect((await admin.get('/api/admin/members/00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await admin.get('/api/admin/members/not-a-uuid')).status).toBe(400);
  });
});

describe('dashboard stats', () => {
  it('come from real queries', async () => {
    await admin.post('/api/admin/members').send(newMemberPayload({ joinedOn: new Date().toISOString().slice(0, 10) }));
    await admin.post('/api/admin/members').send(newMemberPayload({ status: 'INACTIVE' }));
    const s = (await admin.get('/api/admin/dashboard/stats')).body.data;
    expect(s.totalMembers).toBe(2);
    expect(s.activeMembers).toBe(1);
    expect(s.newMembersThisMonth).toBeGreaterThanOrEqual(1);
    expect(s.totalOutstanding).not.toBe('0');
  });
});
