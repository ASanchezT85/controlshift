/**
 * Report branding (MASTER SPEC 39).
 *
 *   npm run build && node --test dist/branding.test.js
 *
 * The logo is the interesting part: it ends up inside an `<img src>` in a
 * document that gets forwarded by email, so the scheme is validated rather
 * than trusted.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient, ProposalType, Role } from '@prisma/client';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { AppModule } from './app.module';
import { storageRoot } from './artifacts';
import { hashPassword } from './auth';
import { MAX_LOGO_BYTES } from './branding';

const prisma = new PrismaClient();
let app: NestFastifyApplication;
let base: string;
let adminTok: string;
let engineerTok: string;
let opportunityId: string;

const marker = `branding-test-${process.pid}`;
const password = 'branding-test-password';
const GOLDEN = resolve(process.cwd(), '..', '..', 'golden', 'opportunities', 'GO-001-PKG-LINE-04');

// A one-pixel PNG: the smallest thing that is genuinely an image.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function call(path: string, tok: string, init: RequestInit = {}) {
  return fetch(`${base}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${tok}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });
}

async function read<T>(res: Response) {
  const text = await res.text();
  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    data = undefined as T;
  }
  return { status: res.status, text, data };
}

async function makeUser(label: string, role: Role, tenantId: string) {
  const user = await prisma.user.create({
    data: {
      tenantId,
      email: `${label}-${marker}@test.local`,
      name: label === 'admin' ? 'Dana Reyes' : 'Sam Okafor',
      role,
      passwordHash: await hashPassword(password),
    },
  });
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: user.email, password }),
  });
  return ((await res.json()) as { accessToken: string }).accessToken;
}

before(async () => {
  app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: false,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  base = `${await app.getUrl()}/api`;

  const tenant = await prisma.tenant.create({ data: { name: marker } });
  adminTok = await makeUser('admin', Role.ORG_ADMIN, tenant.id);
  engineerTok = await makeUser('engineer', Role.CONTROLS_ENGINEER, tenant.id);

  const creator = await prisma.user.findFirstOrThrow({
    where: { tenantId: tenant.id, role: Role.CONTROLS_ENGINEER },
  });
  const opportunity = await prisma.opportunity.create({
    data: {
      tenantId: tenant.id,
      name: `${marker} line`,
      customerName: 'Brandwell Foods',
      facilityName: 'Plant 5',
      proposalType: ProposalType.FIXED_PRICE,
      createdBy: creator.id,
    },
  });
  opportunityId = opportunity.id;

  // Artifacts are inserted directly here on purpose: this suite exercises a
  // layer downstream of intake, and the real ingestion path (allowlist,
  // size ceiling, scanner, audit) is covered by uploads.test.ts and
  // scripts/e2e_go001.py. The declared type matches what a person selects
  // in the upload form, so no unreachable state is encoded.
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
    await prisma.artifact.create({
      data: {
        opportunityId,
        originalFilename: entry.path.split('/').pop()!,
        mediaType: 'application/octet-stream',
        artifactType: entry.artifact_type,
        sha256,
        size: bytes.length,
        storageLocation: relative.split('\\').join('/'),
        processingStatus: 'SCANNED',
      },
    });
  }
  const run = await call(`/opportunities/${opportunityId}/analyses`, engineerTok, {
    method: 'POST',
    body: '{}',
  });
  assert.equal(run.status, 201, await run.clone().text());
});

after(async () => {
  await app?.close();
  await prisma.tenant.deleteMany({ where: { name: marker } });
  await prisma.$disconnect();
});

test('only an org admin changes the organization identity', async () => {
  const refused = await call('/organization/branding', engineerTok, {
    method: 'PATCH',
    body: JSON.stringify({ brandName: 'Not Mine' }),
  });
  assert.equal(refused.status, 403);

  const ok = await read<any>(
    await call('/organization/branding', adminTok, {
      method: 'PATCH',
      body: JSON.stringify({
        brandName: 'Brandwell Integrators',
        reportFooter: 'preflight assessment - not for construction',
        preparedByLine: 'Controls Engineering, P.Eng. 12345',
        brandLogo: PNG,
      }),
    }),
  );
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.data.brandName, 'Brandwell Integrators');
  assert.equal(ok.data.brandLogo, PNG);
});

test('an SVG logo is refused, because a report gets forwarded', async () => {
  const svg =
    'data:image/svg+xml;base64,' +
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString(
      'base64',
    );
  const res = await read<any>(
    await call('/organization/branding', adminTok, {
      method: 'PATCH',
      body: JSON.stringify({ brandLogo: svg }),
    }),
  );
  assert.equal(res.status, 400);
  assert.match(res.data.message, /SVG is not accepted/);
});

test('a non-image or oversized logo is refused', async () => {
  for (const bad of [
    'https://example.com/logo.png',
    'javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
  ]) {
    const res = await call('/organization/branding', adminTok, {
      method: 'PATCH',
      body: JSON.stringify({ brandLogo: bad }),
    });
    assert.equal(res.status, 400, `${bad} should be refused`);
  }

  const huge = 'data:image/png;base64,' + 'A'.repeat(Math.ceil((MAX_LOGO_BYTES + 1024) * 4) / 3);
  const res = await read<any>(
    await call('/organization/branding', adminTok, {
      method: 'PATCH',
      body: JSON.stringify({ brandLogo: huge }),
    }),
  );
  assert.equal(res.status, 400);
});

test('the customer logo is per opportunity and optional', async () => {
  const set = await read<any>(
    await call(`/opportunities/${opportunityId}/customer-logo`, adminTok, {
      method: 'PATCH',
      body: JSON.stringify({ customerLogo: PNG }),
    }),
  );
  assert.equal(set.status, 200, set.text);
  assert.equal(set.data.customerLogo, PNG);

  const cleared = await read<any>(
    await call(`/opportunities/${opportunityId}/customer-logo`, adminTok, {
      method: 'PATCH',
      body: JSON.stringify({ customerLogo: '' }),
    }),
  );
  assert.equal(cleared.data.customerLogo, null);
});

test('every configured element reaches the report cover', async () => {
  await call(`/opportunities/${opportunityId}/customer-logo`, adminTok, {
    method: 'PATCH',
    body: JSON.stringify({ customerLogo: PNG }),
  });

  const generated = await read<any>(
    await call(`/opportunities/${opportunityId}/reports`, adminTok, {
      method: 'POST',
      body: JSON.stringify({ kind: 'ENGINEERING_PREFLIGHT' }),
    }),
  );
  assert.equal(generated.status, 201, generated.text);
  const html = await (await call(`/reports/${generated.data.id}`, adminTok)).text();

  assert.match(html, /Brandwell Integrators/); // organization name
  assert.match(html, /Brandwell Foods/); // customer name
  assert.match(html, /Controls Engineering, P\.Eng\. 12345/); // prepared-by line
  assert.match(html, /preflight assessment - not for construction/); // footer
  assert.match(html, /Dana Reyes/); // the preparer's name, not a login
  assert.ok(!html.includes('@test.local'), 'the cover must not print an email address');
  assert.equal((html.match(/<img /g) ?? []).length, 2, 'organization and customer logos');
});

test('branding changes are audited', async () => {
  const events = await prisma.auditEvent.findMany({
    where: { action: { startsWith: 'branding.' } },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  assert.ok(events.some((e) => e.action === 'branding.updated'));
  assert.ok(events.some((e) => e.action === 'branding.customer_logo_set'));
});
