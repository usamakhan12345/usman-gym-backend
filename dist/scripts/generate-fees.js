"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Manual recovery: `npm run billing:generate` creates any missing monthly fees (idempotent).
const prisma_1 = require("../lib/prisma");
const billing_service_1 = require("../modules/billing/billing.service");
(0, billing_service_1.generateMissingFees)()
    .then((r) => console.log(`Checked ${r.membershipsChecked} memberships, created ${r.feesCreated} fees.`))
    .catch((e) => {
    console.error(e);
    process.exitCode = 1;
})
    .finally(() => prisma_1.prisma.$disconnect());
