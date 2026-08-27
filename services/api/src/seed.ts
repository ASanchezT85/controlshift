/**
 * Seeds one tenant, one user per role, and the GO-001 opportunity with its
 * golden artifacts already uploaded. Idempotent: safe to re-run.
 *
 *   npm run build && node dist/seed.js
 */
import { ArtifactType, PrismaClient, ProposalType, Role } from '@prisma/client';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { hashPassword } from './auth';
import { storageRoot } from './artifacts';

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

  const manifest = JSON.parse(await readFile(join(GOLDEN, 'manifest.json'), 'utf8'));
  for (const entry of manifest.artifacts) {
    const bytes = await readFile(join(GOLDEN, entry.path));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const relative = join('original', tenant.id, sha256.slice(0, 2), sha256);
    const absolute = join(storageRoot(), relative);
    if (!existsSync(absolute)) {
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, bytes);
    }
    const filename = entry.path.split('/').pop()!;
    const existing = await prisma.artifact.findFirst({
      where: { opportunityId: opportunity.id, sha256 },
    });
    if (!existing) {
      await prisma.artifact.create({
        data: {
          opportunityId: opportunity.id,
          originalFilename: filename,
          mediaType: 'application/octet-stream',
          artifactType: (entry.artifact_type as ArtifactType) ?? ArtifactType.OTHER,
          sha256,
          size: bytes.length,
          storageLocation: relative.split('\\').join('/'),
          // Seeded artifacts are ours, not customer uploads: they are the only
          // files in the system that may skip the scanning gate.
          processingStatus: 'SCANNED',
        },
      });
    }
  }

  console.log(`seeded tenant ${tenant.id}`);
  console.log(`opportunity ${opportunity.id} with ${manifest.artifacts.length} artifacts`);
  console.log(`users: ${USERS.map(([e]) => e).join(', ')}`);
  console.log(`password: ${PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
