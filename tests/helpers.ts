import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/lib/security';
import { outbox } from '../src/services/messenger';
import { addMonths, currentYearMonth } from '../src/lib/dates';

export const app = createApp();

export async function resetDb() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE "AuditLog","Payment","MonthlyFee","Membership","MembershipPlan","OtpVerification","PasswordResetRequest","User","Counter","ContactMessage" RESTART IDENTITY CASCADE`,
  );
  outbox.length = 0;
}

export const ADMIN = { email: 'admin@test.local', phone: '+923001111111', password: 'AdminPass123' };

export async function createAdmin() {
  return prisma.user.create({
    data: {
      fullName: 'Test Admin',
      email: ADMIN.email,
      phone: ADMIN.phone,
      passwordHash: await hashPassword(ADMIN.password),
      role: 'ADMIN',
      status: 'ACTIVE',
      verifiedAt: new Date(),
    },
  });
}

export async function loginAs(identifier: string, password: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ identifier, password });
  if (res.status !== 200) throw new Error(`login failed ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

export const adminAgent = () => loginAs(ADMIN.email, ADMIN.password);

/** Last 6-digit code sent to a recipient via the in-memory provider. */
export function lastOtp(to: string): string {
  const msg = [...outbox].reverse().find((m) => m.to === to && /\d{6}/.test(m.text));
  if (!msg) throw new Error(`no OTP sent to ${to}`);
  return /(\d{6})/.exec(msg.text)![1];
}

export const pad = (n: number) => String(n).padStart(2, '0');
/** "YYYY-MM-DD" for the 1st of the month `offset` months from now (app timezone). */
export function firstOfMonth(offset = 0) {
  const ym = addMonths(currentYearMonth(), offset);
  return `${ym.year}-${pad(ym.month)}-01`;
}

let counter = 0;
export function newMemberPayload(over: Record<string, unknown> = {}) {
  counter++;
  return {
    fullName: `Test Member ${counter}`,
    phone: `+92300${String(5000000 + counter)}`,
    email: `member${counter}@test.local`,
    joinedOn: firstOfMonth(-2),
    monthlyFee: '3000',
    ...over,
  };
}

/** Admin creates a member, the member activates via the OTP/reset flow and logs in. */
export async function createActiveMember(admin: ReturnType<typeof request.agent>, over: Record<string, unknown> = {}) {
  const payload = newMemberPayload(over);
  const created = await admin.post('/api/admin/members').send(payload);
  if (created.status !== 201) throw new Error(`create member failed ${JSON.stringify(created.body)}`);
  const password = 'MemberPass123';
  await request(app).post('/api/auth/forgot-password').send({ identifier: payload.email });
  const verified = await request(app)
    .post('/api/auth/verify-otp')
    .send({ identifier: payload.email, purpose: 'PASSWORD_RESET', code: lastOtp(payload.email as string) });
  await request(app).post('/api/auth/reset-password').send({ resetToken: verified.body.data.resetToken, newPassword: password });
  const agent = await loginAs(payload.email as string, password);
  return { member: created.body.data, payload, agent, password };
}
