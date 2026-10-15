// Manual recovery: `npm run billing:generate` creates any missing monthly fees (idempotent).
import { prisma } from '../lib/prisma';
import { generateMissingFees } from '../modules/billing/billing.service';

generateMissingFees()
  .then((r) => console.log(`Checked ${r.membershipsChecked} memberships, created ${r.feesCreated} fees.`))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
