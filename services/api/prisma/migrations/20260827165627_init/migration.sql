-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ORG_ADMIN', 'CONTROLS_ENGINEER', 'ESTIMATOR', 'PROJECT_MANAGER', 'VIEWER');

-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('DRAFT', 'ANALYZING', 'ANALYZED', 'ENGINEERING_REVIEW', 'COMMERCIAL_REVIEW', 'CLOSED');

-- CreateEnum
CREATE TYPE "ProposalType" AS ENUM ('ROM', 'BUDGETARY', 'FIXED_PRICE', 'TIME_AND_MATERIAL', 'DISCOVERY_ONLY');

-- CreateEnum
CREATE TYPE "ArtifactType" AS ENUM ('PLC_SOURCE', 'SYMBOL_DATABASE', 'IO_LIST', 'ELECTRICAL_DRAWING', 'NETWORK_DRAWING', 'HMI_PROJECT', 'DRIVE_BACKUP', 'PHOTO', 'SPREADSHEET', 'CUSTOMER_NOTE', 'MIGRATION_REPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "ProcessingStatus" AS ENUM ('RECEIVED', 'SCANNED', 'PARSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReviewAction" AS ENUM ('ACKNOWLEDGE', 'ACCEPT', 'REJECT', 'RESOLVE', 'OVERRIDE');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "facilityName" TEXT NOT NULL,
    "sourcePlatform" TEXT NOT NULL DEFAULT 'SLC500',
    "requestedTarget" TEXT NOT NULL DEFAULT 'CompactLogix 5380',
    "proposalType" "ProposalType" NOT NULL,
    "proposalDeadline" TIMESTAMP(3),
    "shutdownRequirementHours" DOUBLE PRECISION,
    "commercialNotes" TEXT,
    "engineeringReviewComplete" BOOLEAN NOT NULL DEFAULT false,
    "shutdownFeasible" BOOLEAN NOT NULL DEFAULT false,
    "status" "OpportunityStatus" NOT NULL DEFAULT 'DRAFT',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "artifactType" "ArtifactType" NOT NULL,
    "sha256" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "processingStatus" "ProcessingStatus" NOT NULL DEFAULT 'RECEIVED',
    "rejectionReason" TEXT,
    "storageLocation" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Artifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Analysis" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "irSchemaVersion" TEXT NOT NULL,
    "analysisEngineVersion" TEXT NOT NULL,
    "rulePackVersion" TEXT NOT NULL,
    "targetStrategy" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "failed" BOOLEAN NOT NULL DEFAULT false,
    "failure" TEXT,
    "result" JSONB,

    CONSTRAINT "Analysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FindingReview" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "action" "ReviewAction" NOT NULL,
    "reason" TEXT,
    "overrideState" TEXT,
    "reviewerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FindingReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_email_key" ON "User"("tenantId", "email");

-- CreateIndex
CREATE INDEX "Opportunity_tenantId_status_idx" ON "Opportunity"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Artifact_opportunityId_idx" ON "Artifact"("opportunityId");

-- CreateIndex
CREATE UNIQUE INDEX "Artifact_opportunityId_sha256_key" ON "Artifact"("opportunityId", "sha256");

-- CreateIndex
CREATE INDEX "Analysis_opportunityId_startedAt_idx" ON "Analysis"("opportunityId", "startedAt");

-- CreateIndex
CREATE INDEX "FindingReview_analysisId_findingId_idx" ON "FindingReview"("analysisId", "findingId");

-- CreateIndex
CREATE INDEX "AuditEvent_tenantId_createdAt_idx" ON "AuditEvent"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FindingReview" ADD CONSTRAINT "FindingReview_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
