-- CreateEnum
CREATE TYPE "ReportKind" AS ENUM ('ENGINEERING_PREFLIGHT', 'PROPOSAL_INPUT_PACKAGE', 'CUSTOMER_INFORMATION_REQUEST');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "brandLogo" TEXT,
ADD COLUMN     "brandName" TEXT,
ADD COLUMN     "reportFooter" TEXT,
ADD COLUMN     "uncertaintyAllowancePercent" DOUBLE PRECISION NOT NULL DEFAULT 15;

-- CreateTable
CREATE TABLE "EffortTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workPackageCode" TEXT NOT NULL,
    "unitType" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "minHoursPerUnit" DOUBLE PRECISION NOT NULL,
    "maxHoursPerUnit" DOUBLE PRECISION NOT NULL,
    "complexityFactor" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EffortTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "kind" "ReportKind" NOT NULL,
    "storageLocation" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "reportSchemaVersion" TEXT NOT NULL,
    "generatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EffortTemplate_tenantId_idx" ON "EffortTemplate"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "EffortTemplate_tenantId_workPackageCode_key" ON "EffortTemplate"("tenantId", "workPackageCode");

-- CreateIndex
CREATE INDEX "Report_analysisId_kind_idx" ON "Report"("analysisId", "kind");

-- AddForeignKey
ALTER TABLE "EffortTemplate" ADD CONSTRAINT "EffortTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
