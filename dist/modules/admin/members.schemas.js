"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rejectProofSchema = exports.approveProofSchema = exports.listProofsQuery = exports.paginationQuery = exports.listFeesQuery = exports.correctPaymentSchema = exports.markPaidSchema = exports.listMembersQuery = exports.updateMemberSchema = exports.createMemberSchema = exports.dateString = void 0;
const zod_1 = require("zod");
const identity_1 = require("../../lib/identity");
const dates_1 = require("../../lib/dates");
exports.dateString = zod_1.z
    .string()
    .transform((v, ctx) => {
    const d = (0, dates_1.parseDateOnly)(v);
    if (!d)
        ctx.addIssue({ code: 'custom', message: 'Use a valid date (YYYY-MM-DD)' });
    return d;
});
const optionalEmail = zod_1.z
    .union([identity_1.emailSchema, zod_1.z.literal('').transform(() => null), zod_1.z.null()])
    .optional();
exports.createMemberSchema = zod_1.z
    .object({
    fullName: identity_1.fullNameSchema,
    phone: identity_1.phoneSchema,
    email: optionalEmail,
    joinedOn: exports.dateString,
    monthlyFee: identity_1.moneySchema.optional(),
    planId: zod_1.z.string().uuid().nullable().optional(),
    status: zod_1.z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
})
    .strict();
exports.updateMemberSchema = zod_1.z
    .object({
    fullName: identity_1.fullNameSchema.optional(),
    phone: identity_1.phoneSchema.optional(),
    email: optionalEmail,
    monthlyFee: identity_1.moneySchema.optional(),
    /** Also re-price the current month's fee if it is still unpaid. Past/paid months are never changed. */
    applyToCurrentPending: zod_1.z.boolean().optional(),
    planId: zod_1.z.string().uuid().nullable().optional(),
    status: zod_1.z.enum(['ACTIVE', 'INACTIVE', 'TERMINATED']).optional(),
})
    .strict()
    .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
exports.listMembersQuery = zod_1.z.object({
    search: zod_1.z.string().trim().max(100).optional(),
    page: zod_1.z.coerce.number().int().min(1).default(1),
    limit: zod_1.z.coerce.number().int().min(1).max(100).default(20),
    feeStatus: zod_1.z.enum(['PAID', 'PENDING', 'OVERDUE']).optional(),
    status: zod_1.z.enum(['ACTIVE', 'INACTIVE', 'TERMINATED']).optional(),
});
exports.markPaidSchema = zod_1.z
    .object({
    paymentDate: exports.dateString,
    method: zod_1.z.enum(['CASH', 'BANK_TRANSFER', 'OTHER']),
    reference: zod_1.z.string().trim().max(100).optional(),
    note: zod_1.z.string().trim().max(500).optional(),
    idempotencyKey: zod_1.z.string().trim().min(8).max(100).optional(),
})
    .strict();
exports.correctPaymentSchema = zod_1.z
    .object({
    reason: zod_1.z.string().trim().min(3, 'Please give a reason').max(500),
    replacement: zod_1.z
        .object({
        paymentDate: exports.dateString,
        method: zod_1.z.enum(['CASH', 'BANK_TRANSFER', 'OTHER']),
        reference: zod_1.z.string().trim().max(100).optional(),
        note: zod_1.z.string().trim().max(500).optional(),
    })
        .strict()
        .optional(),
})
    .strict();
exports.listFeesQuery = zod_1.z.object({
    search: zod_1.z.string().trim().max(100).optional(),
    status: zod_1.z.enum(['PAID', 'PENDING', 'OVERDUE']).optional(),
    year: zod_1.z.coerce.number().int().min(2000).max(2100).optional(),
    month: zod_1.z.coerce.number().int().min(1).max(12).optional(),
    page: zod_1.z.coerce.number().int().min(1).default(1),
    limit: zod_1.z.coerce.number().int().min(1).max(100).default(20),
});
exports.paginationQuery = zod_1.z.object({
    search: zod_1.z.string().trim().max(100).optional(),
    page: zod_1.z.coerce.number().int().min(1).default(1),
    limit: zod_1.z.coerce.number().int().min(1).max(100).default(20),
});
exports.listProofsQuery = zod_1.z.object({
    status: zod_1.z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
    search: zod_1.z.string().trim().max(100).optional(),
    page: zod_1.z.coerce.number().int().min(1).default(1),
    limit: zod_1.z.coerce.number().int().min(1).max(100).default(20),
});
exports.approveProofSchema = zod_1.z
    .object({
    paymentDate: exports.dateString.optional(),
    method: zod_1.z.enum(['CASH', 'BANK_TRANSFER', 'OTHER']).optional(),
    reference: zod_1.z.string().trim().max(100).optional(),
    note: zod_1.z.string().trim().max(500).optional(),
})
    .strict();
exports.rejectProofSchema = zod_1.z.object({ reason: zod_1.z.string().trim().min(3, 'Please give a reason').max(500) }).strict();
