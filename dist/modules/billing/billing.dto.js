"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentDto = exports.activePaymentInclude = void 0;
exports.feeDto = feeDto;
const dates_1 = require("../../lib/dates");
const billing_service_1 = require("./billing.service");
/** Include clause that loads only the active payment (the one that made the fee PAID). */
exports.activePaymentInclude = {
    payments: {
        where: { status: 'ACTIVE' },
        take: 1,
        include: { recordedBy: { select: { fullName: true } } },
    },
};
const paymentDto = (p) => ({
    id: p.id,
    feeId: p.feeId,
    amount: p.amount.toString(),
    paidOn: (0, dates_1.ymd)(p.paidOn),
    method: p.method,
    reference: p.reference,
    note: p.note,
    status: p.status,
    recordedBy: p.recordedBy?.fullName ?? null,
    voidedAt: p.voidedAt,
    voidReason: p.voidReason,
    createdAt: p.createdAt,
});
exports.paymentDto = paymentDto;
function feeDto(fee, now) {
    const active = fee.payments?.find((p) => p.status === 'ACTIVE');
    return {
        id: fee.id,
        membershipId: fee.membershipId,
        billingYear: fee.billingYear,
        billingMonth: fee.billingMonth,
        label: (0, dates_1.monthLabel)(fee.billingYear, fee.billingMonth),
        amount: fee.amount.toString(),
        status: (0, billing_service_1.displayStatus)(fee, now),
        dueDate: (0, dates_1.ymd)(fee.dueDate),
        paidAt: fee.paidAt,
        payment: active ? (0, exports.paymentDto)(active) : null,
    };
}
