import { PaymentMethod, PaymentProof, Prisma, ProofStatus, User } from '@prisma/client';
import { audit } from '../../lib/audit';
import { monthLabel, todayDateOnly, ymd } from '../../lib/dates';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { deleteProofImage, saveProofImage } from '../../lib/upload';
import { BuiltEmail, notificationEmail } from '../../services/emailTemplates';
import { channelFor, deliver } from '../../services/messenger';
import { PaymentInput, payFeeInTx } from './payments.service';

// ---------------------------------------------------------------- notifications (best effort, never block the request)
async function sendEmailTo(user: Pick<User, 'id' | 'email' | 'phone'>, email: BuiltEmail) {
  const target = channelFor(user);
  if (!target || target.channel !== 'EMAIL') return; // proof notifications are email only
  try {
    await deliver({ channel: 'EMAIL', to: target.to, subject: email.subject, text: email.text, html: email.html });
  } catch (err) {
    console.error('[proof] notification failed', err);
  }
}

async function notifyAdmins(email: BuiltEmail) {
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN', status: 'ACTIVE' }, select: { id: true, email: true, phone: true } });
  await Promise.all(admins.map((a) => sendEmailTo(a, email)));
}

// ---------------------------------------------------------------- DTOs
const proofSelect = {
  fee: { select: { billingYear: true, billingMonth: true, amount: true, status: true } },
  membership: { select: { id: true, gymId: true, fullName: true, phone: true } },
  reviewedBy: { select: { fullName: true } },
} satisfies Prisma.PaymentProofInclude;

type ProofRow = PaymentProof & Prisma.PaymentProofGetPayload<{ include: typeof proofSelect }>;

export const proofDto = (p: ProofRow, viewer: 'admin' | 'member') => ({
  id: p.id,
  feeId: p.feeId,
  status: p.status,
  method: p.method,
  reference: p.reference,
  note: p.note,
  rejectReason: p.rejectReason,
  createdAt: p.createdAt,
  reviewedAt: p.reviewedAt,
  billingYear: p.fee.billingYear,
  billingMonth: p.fee.billingMonth,
  label: monthLabel(p.fee.billingYear, p.fee.billingMonth),
  amount: p.fee.amount.toString(),
  feeStatus: p.fee.status,
  imageUrl: `/api/${viewer}/proofs/${p.id}/image`,
  ...(viewer === 'admin' ? { member: p.membership, reviewedBy: p.reviewedBy?.fullName ?? null } : {}),
});

// ---------------------------------------------------------------- member side
export async function submitProof(
  member: { id: string; gymId: string; fullName: string },
  feeId: string,
  input: { method: PaymentMethod; reference?: string; note?: string },
  file: Express.Multer.File | undefined,
  ip?: string,
) {
  // Ownership is part of the query: another member's fee id simply "does not exist" for this member.
  const fee = await prisma.monthlyFee.findFirst({ where: { id: feeId, membershipId: member.id } });
  if (!fee) throw notFound('Fee record not found');
  if (fee.status === 'PAID') throw new AppError(409, 'ALREADY_PAID', 'This month is already paid');
  if (await prisma.paymentProof.findFirst({ where: { feeId, status: 'PENDING' }, select: { id: true } })) {
    throw conflict('You already submitted a screenshot for this month. It is waiting for admin review.', 'PROOF_PENDING');
  }

  const imageFile = await saveProofImage(file); // validates the real image type and size
  let proof: ProofRow;
  try {
    proof = await prisma.$transaction(async (tx) => {
      const created = await tx.paymentProof.create({
        data: { feeId, membershipId: member.id, imageFile, method: input.method, reference: input.reference || null, note: input.note || null },
        include: proofSelect,
      });
      await audit({ actorId: null, action: 'proof.submit', entityType: 'PaymentProof', entityId: created.id, metadata: { feeId, membershipId: member.id }, ip }, tx);
      return created;
    });
  } catch (e) {
    await deleteProofImage(imageFile); // do not leave orphan files behind
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw conflict('You already submitted a screenshot for this month. It is waiting for admin review.', 'PROOF_PENDING');
    }
    throw e;
  }

  void notifyAdmins(
    notificationEmail({
      subject: `New payment screenshot from ${member.fullName}`,
      title: 'Payment screenshot received',
      intro: `${member.fullName} (${member.gymId}) uploaded a payment screenshot. Please review it and update their fee status.`,
      rows: [
        ['Member', member.fullName],
        ['Gym ID', member.gymId],
        ['Month', monthLabel(fee.billingYear, fee.billingMonth)],
        ['Amount', `Rs. ${Number(fee.amount).toLocaleString('en-PK')}`],
      ],
      cta: { label: 'Review screenshot', path: '/admin/payment-proofs' },
    }),
  );
  return proofDto(proof, 'member');
}

export async function listMemberProofs(membershipId: string) {
  const rows = await prisma.paymentProof.findMany({ where: { membershipId }, orderBy: { createdAt: 'desc' }, include: proofSelect });
  return rows.map((r) => proofDto(r, 'member'));
}

/** Latest proof per fee, used to decorate the member's fee list. */
export async function latestProofsByFee(membershipId: string, feeIds: string[]) {
  const rows = await prisma.paymentProof.findMany({
    where: { membershipId, feeId: { in: feeIds } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, feeId: true, status: true, rejectReason: true, createdAt: true },
  });
  const map = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!map.has(r.feeId)) map.set(r.feeId, r); // rows are newest-first
  return map;
}

export async function getProofFile(proofId: string, ownerMembershipId?: string) {
  const proof = await prisma.paymentProof.findFirst({ where: { id: proofId, ...(ownerMembershipId ? { membershipId: ownerMembershipId } : {}) } });
  if (!proof) throw notFound('Screenshot not found');
  return proof.imageFile;
}

// ---------------------------------------------------------------- admin side
export async function listProofs(q: { status?: ProofStatus; search?: string; page: number; limit: number }) {
  const where: Prisma.PaymentProofWhereInput = {
    ...(q.status && { status: q.status }),
    ...(q.search && {
      membership: {
        OR: [
          { gymId: { contains: q.search, mode: 'insensitive' } },
          { fullName: { contains: q.search, mode: 'insensitive' } },
          { phone: { contains: q.search } },
        ],
      },
    }),
  };
  const [total, rows] = await Promise.all([
    prisma.paymentProof.count({ where }),
    prisma.paymentProof.findMany({
      where,
      // Oldest pending first so nobody waits forever; reviewed ones newest first.
      orderBy: { createdAt: q.status === 'PENDING' ? 'asc' : 'desc' },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      include: proofSelect,
    }),
  ]);
  return { items: rows.map((r) => proofDto(r, 'admin')), total };
}

export const pendingProofCount = () => prisma.paymentProof.count({ where: { status: 'PENDING' } });

/**
 * Approving a screenshot = recording the payment. The proof claim, fee PENDING->PAID, payment row and
 * audit entries commit together; if the fee was meanwhile paid another way the whole thing rolls back (409).
 */
export async function approveProof(
  proofId: string,
  adminId: string,
  override: { paymentDate?: Date; method?: PaymentMethod; reference?: string; note?: string },
  ip?: string,
) {
  const paymentDate = override.paymentDate ?? todayDateOnly();
  if (paymentDate.getTime() > todayDateOnly().getTime()) throw badRequest('Payment date cannot be in the future');

  const result = await prisma.$transaction(async (tx) => {
    const proof = await tx.paymentProof.findUnique({ where: { id: proofId }, include: proofSelect });
    if (!proof) throw notFound('Screenshot not found');

    const claimed = await tx.paymentProof.updateMany({
      where: { id: proofId, status: 'PENDING' },
      data: { status: 'APPROVED', reviewedById: adminId, reviewedAt: new Date() },
    });
    if (claimed.count !== 1) throw new AppError(409, 'ALREADY_REVIEWED', 'This screenshot has already been reviewed');

    const input: PaymentInput = {
      paymentDate,
      method: override.method ?? proof.method,
      reference: override.reference ?? proof.reference,
      note: override.note ?? proof.note ?? 'Approved from member screenshot',
    };
    const paymentId = await payFeeInTx(tx, proof.feeId, adminId, input, null, ip);
    await tx.paymentProof.update({ where: { id: proofId }, data: { paymentId } });
    await audit({ actorId: adminId, action: 'proof.approve', entityType: 'PaymentProof', entityId: proofId, metadata: { paymentId, feeId: proof.feeId }, ip }, tx);
    return { proof, paymentId };
  });

  const member = await prisma.membership.findUnique({ where: { id: result.proof.membershipId }, include: { user: true } });
  if (member?.user) {
    void sendEmailTo(
      member.user,
      notificationEmail({
        subject: 'Your payment has been confirmed',
        title: 'Payment confirmed',
        intro: `Thank you! The gym has checked your screenshot and marked ${monthLabel(result.proof.fee.billingYear, result.proof.fee.billingMonth)} as paid.`,
        rows: [['Month', monthLabel(result.proof.fee.billingYear, result.proof.fee.billingMonth)], ['Amount', `Rs. ${Number(result.proof.fee.amount).toLocaleString('en-PK')}`], ['Paid on', ymd(paymentDate)!]],
        cta: { label: 'View my fees', path: '/member/fees' },
      }),
    );
  }
  return getProofDto(proofId);
}

export async function rejectProof(proofId: string, adminId: string, reason: string, ip?: string) {
  const proof = await prisma.$transaction(async (tx) => {
    const found = await tx.paymentProof.findUnique({ where: { id: proofId }, include: proofSelect });
    if (!found) throw notFound('Screenshot not found');
    const claimed = await tx.paymentProof.updateMany({
      where: { id: proofId, status: 'PENDING' },
      data: { status: 'REJECTED', reviewedById: adminId, reviewedAt: new Date(), rejectReason: reason },
    });
    if (claimed.count !== 1) throw new AppError(409, 'ALREADY_REVIEWED', 'This screenshot has already been reviewed');
    await audit({ actorId: adminId, action: 'proof.reject', entityType: 'PaymentProof', entityId: proofId, metadata: { reason }, ip }, tx);
    return found;
  });

  const member = await prisma.membership.findUnique({ where: { id: proof.membershipId }, include: { user: true } });
  if (member?.user) {
    void sendEmailTo(
      member.user,
      notificationEmail({
        subject: 'Your payment screenshot could not be accepted',
        title: 'Screenshot not accepted',
        intro: `We could not confirm your payment for ${monthLabel(proof.fee.billingYear, proof.fee.billingMonth)}. Your fee is still unpaid.`,
        note: { text: `Reason: ${reason}`, tone: 'danger' },
        cta: { label: 'Upload again', path: '/member/fees' },
      }),
    );
  }
  return getProofDto(proofId);
}

async function getProofDto(id: string) {
  const p = await prisma.paymentProof.findUniqueOrThrow({ where: { id }, include: proofSelect });
  return proofDto(p, 'admin');
}
