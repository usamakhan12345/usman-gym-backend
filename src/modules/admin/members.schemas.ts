import { z } from 'zod';
import { emailSchema, fullNameSchema, moneySchema, phoneSchema } from '../../lib/identity';
import { parseDateOnly } from '../../lib/dates';

export const dateString = z
  .string()
  .transform((v, ctx) => {
    const d = parseDateOnly(v);
    if (!d) ctx.addIssue({ code: 'custom', message: 'Use a valid date (YYYY-MM-DD)' });
    return d as Date;
  });

const optionalEmail = z
  .union([emailSchema, z.literal('').transform(() => null), z.null()])
  .optional();

export const createMemberSchema = z
  .object({
    fullName: fullNameSchema,
    phone: phoneSchema,
    email: optionalEmail,
    joinedOn: dateString,
    monthlyFee: moneySchema.optional(),
    planId: z.string().uuid().nullable().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
  })
  .strict();

export const updateMemberSchema = z
  .object({
    fullName: fullNameSchema.optional(),
    phone: phoneSchema.optional(),
    email: optionalEmail,
    monthlyFee: moneySchema.optional(),
    /** Also re-price the current month's fee if it is still unpaid. Past/paid months are never changed. */
    applyToCurrentPending: z.boolean().optional(),
    planId: z.string().uuid().nullable().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE', 'TERMINATED']).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const listMembersQuery = z.object({
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  feeStatus: z.enum(['PAID', 'PENDING', 'OVERDUE']).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'TERMINATED']).optional(),
});

export const markPaidSchema = z
  .object({
    paymentDate: dateString,
    method: z.enum(['CASH', 'BANK_TRANSFER', 'OTHER']),
    reference: z.string().trim().max(100).optional(),
    note: z.string().trim().max(500).optional(),
    idempotencyKey: z.string().trim().min(8).max(100).optional(),
  })
  .strict();

export const correctPaymentSchema = z
  .object({
    reason: z.string().trim().min(3, 'Please give a reason').max(500),
    replacement: z
      .object({
        paymentDate: dateString,
        method: z.enum(['CASH', 'BANK_TRANSFER', 'OTHER']),
        reference: z.string().trim().max(100).optional(),
        note: z.string().trim().max(500).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const listFeesQuery = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['PAID', 'PENDING', 'OVERDUE']).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const paginationQuery = z.object({
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const listProofsQuery = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const approveProofSchema = z
  .object({
    paymentDate: dateString.optional(),
    method: z.enum(['CASH', 'BANK_TRANSFER', 'OTHER']).optional(),
    reference: z.string().trim().max(100).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const rejectProofSchema = z.object({ reason: z.string().trim().min(3, 'Please give a reason').max(500) }).strict();
