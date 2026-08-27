-- CreateEnum
CREATE TYPE "ValidationState" AS ENUM ('ASSUMED', 'VALIDATED', 'INVALIDATED');

-- CreateTable
CREATE TABLE "Assumption" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "consequenceIfFalse" TEXT NOT NULL,
    "affectedScope" TEXT[],
    "validationState" "ValidationState" NOT NULL DEFAULT 'ASSUMED',
    "sourceUnknownId" TEXT,
    "createdBy" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assumption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exclusion" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "scopeArea" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "relatedUnknowns" TEXT[],
    "relatedFindings" TEXT[],
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Exclusion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Assumption_opportunityId_idx" ON "Assumption"("opportunityId");

-- CreateIndex
CREATE INDEX "Exclusion_opportunityId_idx" ON "Exclusion"("opportunityId");

-- AddForeignKey
ALTER TABLE "Assumption" ADD CONSTRAINT "Assumption_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exclusion" ADD CONSTRAINT "Exclusion_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

