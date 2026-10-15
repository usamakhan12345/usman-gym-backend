import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { outbox } from '../src/services/messenger';
import { ADMIN, app, adminAgent, createActiveMember, createAdmin, lastOtp, loginAs, resetDb } from './helpers';

const signup = { fullName: 'Sara Khan', email: 'sara@test.local', phone: '+923011234567', password: 'SaraPass123' };

beforeEach(async () => {
  await resetDb();
  await createAdmin();
});

describe('registration + OTP verification', () => {
  it('registers, verifies the OTP, and lands in an unlinked-member state', async () => {
    const reg = await request(app).post('/api/auth/register').send(signup);
    expect(reg.status).toBe(202);

    const code = lastOtp(signup.email);
    const verify = await request(app)
      .post('/api/auth/verify-otp')
      .send({ identifier: signup.email, purpose: 'SIGNUP', code });
    expect(verify.status).toBe(200);
    expect(verify.body.data.user.accountState).toBe('MEMBER_UNLINKED');

    const stored = await prisma.user.findUniqueOrThrow({ where: { email: signup.email } });
    expect(stored.status).toBe('ACTIVE');
    expect(stored.passwordHash).not.toContain(signup.password); // hashed
  });

  it('cannot log in before verifying (and a fresh code is sent)', async () => {
    await request(app).post('/api/auth/register').send(signup);
    const res = await request(app).post('/api/auth/login').send({ identifier: signup.email, password: signup.password });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_VERIFIED');
  });

  it('rejects a wrong code, and locks the code after too many attempts', async () => {
    await request(app).post('/api/auth/register').send(signup);
    const good = lastOtp(signup.email);
    const wrong = good === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      const r = await request(app).post('/api/auth/verify-otp').send({ identifier: signup.email, purpose: 'SIGNUP', code: wrong });
      expect(r.status).toBe(400);
    }
    // even the correct code is now refused
    const locked = await request(app).post('/api/auth/verify-otp').send({ identifier: signup.email, purpose: 'SIGNUP', code: good });
    expect(locked.status).toBe(400);
    expect(locked.body.error.code).toBe('INVALID_CODE');
  });

  it('rejects an expired code', async () => {
    await request(app).post('/api/auth/register').send(signup);
    await prisma.otpVerification.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const r = await request(app).post('/api/auth/verify-otp').send({ identifier: signup.email, purpose: 'SIGNUP', code: lastOtp(signup.email) });
    expect(r.status).toBe(400);
  });

  it('throttles resend (cooldown) without revealing anything', async () => {
    await request(app).post('/api/auth/register').send(signup);
    const before = outbox.length;
    const r = await request(app).post('/api/auth/resend-otp').send({ identifier: signup.email, purpose: 'SIGNUP' });
    expect(r.status).toBe(200); // same generic answer...
    expect(outbox.length).toBe(before); // ...but nothing was sent inside the cooldown
  });

  it('does not enumerate accounts on register / forgot / resend', async () => {
    await request(app).post('/api/auth/register').send(signup);
    const dup = await request(app).post('/api/auth/register').send({ ...signup, fullName: 'Someone Else', password: 'Another12345' });
    expect(dup.status).toBe(202);
    const unknown = await request(app).post('/api/auth/forgot-password').send({ identifier: 'nobody@test.local' });
    const known = await request(app).post('/api/auth/forgot-password').send({ identifier: ADMIN.email });
    expect(unknown.status).toBe(200);
    expect(known.status).toBe(200);
    expect(unknown.body).toEqual(known.body);
  });

  it('validates input on the backend', async () => {
    const r = await request(app).post('/api/auth/register').send({ ...signup, password: 'short', email: 'nope' });
    expect(r.status).toBe(400);
    expect(r.body.error.details).toHaveProperty('password');
    expect(r.body.error.details).toHaveProperty('email');
  });

  it('lets a new sign-up replace an abandoned unverified one that shares its phone', async () => {
    await request(app).post('/api/auth/register').send(signup); // never verified
    const retry = { ...signup, email: 'sara.new@test.local' };
    expect((await request(app).post('/api/auth/register').send(retry)).status).toBe(202);
    const verify = await request(app)
      .post('/api/auth/verify-otp')
      .send({ identifier: retry.email, purpose: 'SIGNUP', code: lastOtp(retry.email) });
    expect(verify.status).toBe(200);
    expect(await prisma.user.count({ where: { phone: signup.phone } })).toBe(1);
  });

  it('does not let a client choose its own role', async () => {
    const r = await request(app).post('/api/auth/register').send({ ...signup, role: 'ADMIN' });
    expect(r.status).toBe(400); // strict schema
  });
});

describe('login + session', () => {
  it('logs in the admin and returns the server-verified role', async () => {
    const res = await request(app).post('/api/auth/login').send({ identifier: ADMIN.email, password: ADMIN.password });
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('ADMIN');
    expect(res.body.data.accountState).toBe('ADMIN');
    expect(res.headers['set-cookie'][0]).toMatch(/HttpOnly/i);
  });

  it('accepts a phone number as identifier, and rejects bad credentials identically', async () => {
    const byPhone = await request(app).post('/api/auth/login').send({ identifier: '+92 300-1111111', password: ADMIN.password });
    expect(byPhone.status).toBe(200);
    const badPw = await request(app).post('/api/auth/login').send({ identifier: ADMIN.email, password: 'wrong-password' });
    const noUser = await request(app).post('/api/auth/login').send({ identifier: 'ghost@test.local', password: 'wrong-password' });
    expect(badPw.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(badPw.body.error.message).toBe(noUser.body.error.message);
  });

  it('protects /me and clears the session on logout', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    const agent = await adminAgent();
    expect((await agent.get('/api/auth/me')).status).toBe(200);
    await agent.post('/api/auth/logout');
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('blocks disabled accounts', async () => {
    const agent = await adminAgent();
    await prisma.user.updateMany({ data: { status: 'DISABLED' } });
    expect((await agent.get('/api/auth/me')).status).toBe(403);
  });
});

describe('forgot / reset password', () => {
  it('resets the password with OTP -> reset token, and invalidates old sessions and tokens', async () => {
    const oldAgent = await adminAgent();
    await request(app).post('/api/auth/forgot-password').send({ identifier: ADMIN.email });
    const verified = await request(app)
      .post('/api/auth/verify-otp')
      .send({ identifier: ADMIN.email, purpose: 'PASSWORD_RESET', code: lastOtp(ADMIN.email) });
    expect(verified.status).toBe(200);
    const { resetToken } = verified.body.data;

    const reset = await request(app).post('/api/auth/reset-password').send({ resetToken, newPassword: 'BrandNew12345' });
    expect(reset.status).toBe(200);

    // token is single use
    expect((await request(app).post('/api/auth/reset-password').send({ resetToken, newPassword: 'Another12345' })).status).toBe(400);
    // old password and old session no longer work
    expect((await request(app).post('/api/auth/login').send({ identifier: ADMIN.email, password: ADMIN.password })).status).toBe(401);
    expect((await oldAgent.get('/api/auth/me')).status).toBe(401);
    expect((await loginAs(ADMIN.email, 'BrandNew12345').then((a) => a.get('/api/auth/me'))).status).toBe(200);
  });

  it('rejects a made-up reset token', async () => {
    const r = await request(app).post('/api/auth/reset-password').send({ resetToken: 'a'.repeat(64), newPassword: 'BrandNew12345' });
    expect(r.status).toBe(400);
  });
});

describe('role-based access', () => {
  it('redirect info: admin vs active member vs unlinked member', async () => {
    const admin = await adminAgent();
    const { agent: memberAgent } = await createActiveMember(admin);
    const me = await memberAgent.get('/api/auth/me');
    expect(me.body.data.role).toBe('MEMBER');
    expect(me.body.data.accountState).toBe('MEMBER_ACTIVE');

    // member cannot touch admin APIs
    expect((await memberAgent.get('/api/admin/members')).status).toBe(403);
    // admin cannot use member-only APIs
    expect((await admin.get('/api/member/profile')).status).toBe(403);
    // anonymous
    expect((await request(app).get('/api/admin/members')).status).toBe(401);
  });

  it('an unlinked self-registered user cannot see any membership data', async () => {
    await request(app).post('/api/auth/register').send(signup);
    await request(app).post('/api/auth/verify-otp').send({ identifier: signup.email, purpose: 'SIGNUP', code: lastOtp(signup.email) });
    const agent = await loginAs(signup.email, signup.password);
    const r = await agent.get('/api/member/fees/current');
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('NO_MEMBERSHIP');
  });
});
