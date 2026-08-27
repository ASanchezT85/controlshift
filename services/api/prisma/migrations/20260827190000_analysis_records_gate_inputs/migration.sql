-- AlterTable
ALTER TABLE "Analysis" ADD COLUMN     "engineeringReviewComplete" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shutdownFeasible" BOOLEAN NOT NULL DEFAULT false;

