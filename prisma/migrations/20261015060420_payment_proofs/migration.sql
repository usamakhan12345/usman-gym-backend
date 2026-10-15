-- CreateEnum
CREATE TYPE "ProofStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- DropIndex
DROP INDEX "Membership_phone_trgm";

-- CreateTable
CREATE TABLE "PaymentProof" (
    "id" UUID NOT NULL,
    "feeId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "imageFile" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "status" "ProofStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "paymentId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentProof_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentProof_paymentId_key" ON "PaymentProof"("paymentId");

-- CreateIndex
CREATE INDEX "PaymentProof_status_createdAt_idx" ON "PaymentProof"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentProof_membershipId_createdAt_idx" ON "PaymentProof"("membershipId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentProof_feeId_idx" ON "PaymentProof"("feeId");

-- AddForeignKey
ALTER TABLE "PaymentProof" ADD CONSTRAINT "PaymentProof_feeId_fkey" FOREIGN KEY ("feeId") REFERENCES "MonthlyFee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentProof" ADD CONSTRAINT "PaymentProof_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentProof" ADD CONSTRAINT "PaymentProof_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentProof" ADD CONSTRAINT "PaymentProof_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- At most one proof waiting for review per fee (a rejected proof can be re-submitted afterwards).
CREATE UNIQUE INDEX "PaymentProof_one_pending_per_fee" ON "PaymentProof"("feeId") WHERE "status" = 'PENDING';
