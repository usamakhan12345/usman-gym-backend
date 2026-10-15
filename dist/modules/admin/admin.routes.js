"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminRouter = void 0;
const express_1 = require("express");
const http_1 = require("../../lib/http");
const auth_1 = require("../../middleware/auth");
const prisma_1 = require("../../lib/prisma");
const audit_1 = require("../../lib/audit");
const upload_1 = require("../../lib/upload");
const errors_1 = require("../../lib/errors");
const billing_service_1 = require("../billing/billing.service");
const payments_service_1 = require("../billing/payments.service");
const schemas = __importStar(require("./members.schemas"));
const members = __importStar(require("./members.service"));
const fees = __importStar(require("./fees.service"));
const proofs_service_1 = require("../billing/proofs.service");
const upload_2 = require("../../lib/upload");
const zod_1 = require("zod");
const content_admin_routes_1 = require("../content/content.admin.routes");
exports.adminRouter = (0, express_1.Router)();
exports.adminRouter.use(auth_1.adminOnly);
// ---------------------------------------------------------------- dashboard
exports.adminRouter.get('/dashboard/stats', (0, http_1.asyncHandler)(async (_req, res) => (0, http_1.ok)(res, { ...(await fees.dashboardStats()), pendingProofs: await (0, proofs_service_1.pendingProofCount)() })));
// ---------------------------------------------------------------- members
exports.adminRouter.post('/members', (0, http_1.validate)({ body: schemas.createMemberSchema }), (0, http_1.asyncHandler)(async (req, res) => (0, http_1.ok)(res, await members.createMember(req.body, req.user.id, (0, http_1.clientIp)(req)), 201)));
exports.adminRouter.get('/members', (0, http_1.validate)({ query: schemas.listMembersQuery }), (0, http_1.asyncHandler)(async (req, res) => {
    const q = req.query;
    const { items, total } = await members.listMembers(q);
    (0, http_1.paginated)(res, items, q.page, q.limit, total);
}));
exports.adminRouter.get('/members/unlinked-users', (0, http_1.asyncHandler)(async (_req, res) => (0, http_1.ok)(res, await members.listUnlinkedUsers())));
const memberId = (0, http_1.validate)({ params: (0, http_1.uuidParam)('memberId') });
exports.adminRouter.get('/members/:memberId', memberId, (0, http_1.asyncHandler)(async (req, res) => (0, http_1.ok)(res, await members.getMember(req.params.memberId))));
exports.adminRouter.patch('/members/:memberId', memberId, (0, http_1.validate)({ body: schemas.updateMemberSchema }), (0, http_1.asyncHandler)(async (req, res) => (0, http_1.ok)(res, await members.updateMember(req.params.memberId, req.body, req.user.id, (0, http_1.clientIp)(req)))));
exports.adminRouter.get('/members/:memberId/fees', memberId, (0, http_1.asyncHandler)(async (req, res) => (0, http_1.ok)(res, await members.getMemberFees(req.params.memberId))));
exports.adminRouter.get('/members/:memberId/payments', memberId, (0, http_1.asyncHandler)(async (req, res) => (0, http_1.ok)(res, await members.getMemberPayments(req.params.memberId))));
exports.adminRouter.post('/members/:memberId/resend-invite', memberId, (0, http_1.asyncHandler)(async (req, res) => (0, http_1.ok)(res, await members.resendInvite(req.params.memberId))));
exports.adminRouter.patch('/members/:memberId/profile-image', memberId, upload_1.imageUpload, (0, http_1.asyncHandler)(async (req, res) => {
    const m = await prisma_1.prisma.membership.findUnique({ where: { id: req.params.memberId }, include: { user: true } });
    if (!m?.user)
        throw (0, errors_1.notFound)('Member not found');
    const name = await (0, upload_1.saveProfileImage)(req.file);
    await prisma_1.prisma.user.update({ where: { id: m.user.id }, data: { profileImage: name } });
    await (0, upload_1.deleteProfileImage)(m.user.profileImage);
    await (0, audit_1.audit)({ actorId: req.user.id, action: 'member.profile_image', entityType: 'Membership', entityId: m.id, ip: (0, http_1.clientIp)(req) });
    (0, http_1.ok)(res, { profileImageUrl: (0, upload_1.profileImageUrl)(name) });
}));
// ---------------------------------------------------------------- fees & payments
const feeId = (0, http_1.validate)({ params: (0, http_1.uuidParam)('feeId') });
exports.adminRouter.get('/fees', (0, http_1.validate)({ query: schemas.listFeesQuery }), (0, http_1.asyncHandler)(async (req, res) => {
    const q = req.query;
    const { items, total } = await fees.listFees(q);
    (0, http_1.paginated)(res, items, q.page, q.limit, total);
}));
for (const [path, status] of [['/fees/pending', 'PENDING'], ['/fees/paid', 'PAID']]) {
    exports.adminRouter.get(path, (0, http_1.validate)({ query: schemas.listFeesQuery }), (0, http_1.asyncHandler)(async (req, res) => {
        const q = { ...req.query, status };
        const { items, total } = await fees.listFees(q);
        (0, http_1.paginated)(res, items, q.page, q.limit, total);
    }));
}
exports.adminRouter.patch('/fees/:feeId/mark-paid', feeId, (0, http_1.validate)({ body: schemas.markPaidSchema }), (0, http_1.asyncHandler)(async (req, res) => (0, http_1.ok)(res, await (0, payments_service_1.markFeePaid)(req.params.feeId, req.user.id, req.body, (0, http_1.clientIp)(req)))));
exports.adminRouter.patch('/fees/:feeId/correct-payment', feeId, (0, http_1.validate)({ body: schemas.correctPaymentSchema }), (0, http_1.asyncHandler)(async (req, res) => (0, http_1.ok)(res, await (0, payments_service_1.correctPayment)(req.params.feeId, req.user.id, req.body, (0, http_1.clientIp)(req)))));
exports.adminRouter.get('/payments', (0, http_1.validate)({ query: schemas.paginationQuery }), (0, http_1.asyncHandler)(async (req, res) => {
    const q = req.query;
    const { items, total } = await fees.listPayments(q);
    (0, http_1.paginated)(res, items, q.page, q.limit, total);
}));
// Manual recovery / catch-up for the monthly billing job.
exports.adminRouter.post('/billing/generate', (0, http_1.asyncHandler)(async (req, res) => {
    const result = await (0, billing_service_1.generateMissingFees)();
    await (0, audit_1.audit)({ actorId: req.user.id, action: 'billing.generate', entityType: 'Billing', metadata: { ...result, upTo: `-` }, ip: (0, http_1.clientIp)(req) });
    (0, http_1.ok)(res, result);
}));
// ---------------------------------------------------------------- member payment screenshots
exports.adminRouter.get('/proofs', (0, http_1.validate)({ query: schemas.listProofsQuery }), (0, http_1.asyncHandler)(async (req, res) => {
    const q = req.query;
    const { items, total } = await (0, proofs_service_1.listProofs)(q);
    (0, http_1.paginated)(res, items, q.page, q.limit, total);
}));
exports.adminRouter.get('/proofs/:id/image', (0, http_1.validate)({ params: (0, http_1.uuidParam)('id') }), (0, http_1.asyncHandler)(async (req, res) => {
    const file = await (0, proofs_service_1.getProofFile)(req.params.id);
    res.set({ 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' });
    res.sendFile((0, upload_2.proofImageFile)(file));
}));
exports.adminRouter.patch('/proofs/:id/approve', (0, http_1.validate)({ params: (0, http_1.uuidParam)('id'), body: schemas.approveProofSchema }), (0, http_1.asyncHandler)(async (req, res) => (0, http_1.ok)(res, await (0, proofs_service_1.approveProof)(req.params.id, req.user.id, req.body, (0, http_1.clientIp)(req)))));
exports.adminRouter.patch('/proofs/:id/reject', (0, http_1.validate)({ params: (0, http_1.uuidParam)('id'), body: schemas.rejectProofSchema }), (0, http_1.asyncHandler)(async (req, res) => (0, http_1.ok)(res, await (0, proofs_service_1.rejectProof)(req.params.id, req.user.id, req.body.reason, (0, http_1.clientIp)(req)))));
// Badge counts for the admin sidebar.
exports.adminRouter.get('/notifications', (0, http_1.asyncHandler)(async (_req, res) => {
    const [pendingProofs, pendingSignups] = await Promise.all([
        (0, proofs_service_1.pendingProofCount)(),
        prisma_1.prisma.user.count({ where: { role: 'MEMBER', membership: null, status: 'ACTIVE' } }),
    ]);
    (0, http_1.ok)(res, { pendingProofs, pendingSignups });
}));
// Paid vs unpaid members per month, for the dashboard chart.
exports.adminRouter.get('/dashboard/monthly', (0, http_1.validate)({ query: zod_1.z.object({ months: zod_1.z.coerce.number().int().min(3).max(24).default(12) }) }), (0, http_1.asyncHandler)(async (req, res) => (0, http_1.ok)(res, await fees.monthlyBreakdown(req.query.months))));
exports.adminRouter.use(content_admin_routes_1.contentAdminRouter);
