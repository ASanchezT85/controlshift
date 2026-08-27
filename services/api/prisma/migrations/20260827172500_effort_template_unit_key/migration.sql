-- DropIndex
DROP INDEX "EffortTemplate_tenantId_workPackageCode_key";

-- CreateIndex
CREATE UNIQUE INDEX "EffortTemplate_tenantId_workPackageCode_unitType_key" ON "EffortTemplate"("tenantId", "workPackageCode", "unitType");

