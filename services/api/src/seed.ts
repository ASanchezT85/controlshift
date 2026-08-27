/**
 * Seeds one tenant, one user per role, and the GO-001 opportunity with its
 * golden artifacts already uploaded. Idempotent: safe to re-run.
 *
 *   npm run build && node dist/seed.js
 */
import { NestFactory } from '@nestjs/core';
import { PrismaClient, ProposalType, Role } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { AppModule } from './app.module';
import { ArtifactsService } from './artifacts';
import { BrandingService } from './branding';
import { hashPassword, type Principal } from './auth';
import { STARTER_TEMPLATES } from './estimating';

const prisma = new PrismaClient();

const GOLDEN = resolve(
  process.cwd(),
  '..',
  '..',
  'golden',
  'opportunities',
  'GO-001-PKG-LINE-04',
);

const USERS: Array<[string, string, Role]> = [
  ['admin@northstar-integrators.test', 'Dana Reyes', Role.ORG_ADMIN],
  ['engineer@northstar-integrators.test', 'Sam Okafor', Role.CONTROLS_ENGINEER],
  ['estimator@northstar-integrators.test', 'Priya Nair', Role.ESTIMATOR],
  ['pm@northstar-integrators.test', 'Chris Weller', Role.PROJECT_MANAGER],
  ['viewer@northstar-integrators.test', 'Alex Duarte', Role.VIEWER],
];

const PASSWORD = 'controlshift-dev';

async function main() {
  const tenant =
    (await prisma.tenant.findFirst({ where: { name: 'Northstar Integrators' } })) ??
    (await prisma.tenant.create({ data: { name: 'Northstar Integrators' } }));

  // Starter effort templates. They belong to the organization from the moment
  // they are written and are expected to be replaced with its real numbers.
  for (const t of STARTER_TEMPLATES) {
    await prisma.effortTemplate.upsert({
      where: {
        tenantId_workPackageCode_unitType: {
          tenantId: tenant.id,
          workPackageCode: t.workPackageCode,
          unitType: t.unitType,
        },
      },
      create: { ...t, tenantId: tenant.id },
      update: {},
    });
  }

  for (const [email, name, role] of USERS) {
    const existing = await prisma.user.findFirst({ where: { tenantId: tenant.id, email } });
    if (!existing) {
      await prisma.user.create({
        data: { tenantId: tenant.id, email, name, role, passwordHash: await hashPassword(PASSWORD) },
      });
    }
  }

  let opportunity = await prisma.opportunity.findFirst({
    where: { tenantId: tenant.id, name: 'GO-001 PKG-LINE-04' },
  });
  if (!opportunity) {
    const creator = await prisma.user.findFirstOrThrow({
      where: { tenantId: tenant.id, role: Role.CONTROLS_ENGINEER },
    });
    opportunity = await prisma.opportunity.create({
      data: {
        tenantId: tenant.id,
        name: 'GO-001 PKG-LINE-04',
        customerName: 'Northstar Foods',
        facilityName: 'Plant 03 - Packaging',
        proposalType: ProposalType.FIXED_PRICE,
        shutdownRequirementHours: 12,
        commercialNotes:
          'Customer wants a fixed price. Maximum shutdown 12 h over a Sunday. ' +
          'No HMI project file, no drive backups, no DeviceNet configuration.',
        createdBy: creator.id,
      },
    });
  }

  // Artifacts go through the SAME service the HTTP upload uses. A seed that
  // writes rows directly walks around the extension allowlist, the size
  // ceiling, the write-once store, the malware scan and the audit trail - and
  // then every test built on it passes over data no user could have produced.
  const context = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const artifacts = context.get(ArtifactsService);
  const seeder = await prisma.user.findFirstOrThrow({
    where: { tenantId: tenant.id, role: Role.CONTROLS_ENGINEER },
  });
  const principal: Principal = {
    userId: seeder.id,
    tenantId: tenant.id,
    role: seeder.role,
    email: seeder.email,
  };

  // Branding through the same service the admin screen uses, so the logo
  // validation and the audit event are the ones the product actually runs.
  const admin = await prisma.user.findFirstOrThrow({
    where: { tenantId: tenant.id, role: Role.ORG_ADMIN },
  });
  await context.get(BrandingService).update(
    { userId: admin.id, tenantId: tenant.id, role: admin.role, email: admin.email },
    {
      brandName: 'Northstar Integrators',
      preparedByLine: 'Controls Engineering - P.Eng. 41208',
      reportFooter:
        'Northstar Integrators - preflight assessment - not for construction or procurement',
    },
  );

  const manifest = JSON.parse(await readFile(join(GOLDEN, 'manifest.json'), 'utf8'));
  const statuses: string[] = [];
  for (const entry of manifest.artifacts) {
    const bytes = await readFile(join(GOLDEN, entry.path));
    const filename = entry.path.split('/').pop()!;
    // The manifest type is DECLARED, exactly as a person declares it in the
    // upload form. The extension is never allowed to decide a type that feeds
    // an evidence domain.
    const artifact = await artifacts.upload(
      principal,
      opportunity.id,
      filename,
      'application/octet-stream',
      bytes,
      entry.artifact_type,
    );
    statuses.push(artifact.processingStatus);
  }
  await context.close();

  const unscanned = statuses.filter((s) => s !== 'SCANNED').length;

  console.log(`seeded tenant ${tenant.id}`);
  console.log(`opportunity ${opportunity.id} with ${manifest.artifacts.length} artifacts`);
  if (unscanned > 0) {
    console.log(
      [
        '',
        `  ${unscanned} artifact(s) did not clear malware scanning, so analysis will`,
        '  refuse them. That is the product working, not the seed failing.',
        '  Start a scanner (docs/scanner-setup.md) and re-run, or set',
        '  ALLOW_UNSCANNED_ARTIFACTS=true for a development environment.',
      ].join('\n'),
    );
  }
  console.log(`users: ${USERS.map(([e]) => e).join(', ')}`);
  console.log(`password: ${PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
