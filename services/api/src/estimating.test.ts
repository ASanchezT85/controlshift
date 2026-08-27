/**
 * Estimating and reports (MASTER SPEC 32/33/38) against a real database and a
 * real analysis produced by the engine.
 *
 *   npm run build && node --test dist/estimating.test.js
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
import { STARTER_TEMPLATES, type Estimate } from './estimating';

const prisma = new PrismaClient();
let app: NestFastifyApplication;
let base: string;
let tok: string;
let estimatorTok: string;
let opportunityId: string;

const marker = `estimating-test-${process.pid}`;
const password = 'estimating-test-password';
const GOLDEN = resolve(process.cwd(), '..', '..', 'golden', 'opportunities', 'GO-001-PKG-LINE-04');

function call(path: string, init: RequestInit = {}) {
  return fetch(`${base}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${tok}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });
}

before(async () => {
  app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: false,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  base = `${await app.getUrl()}/api`;

  const tenant = await prisma.tenant.create({
    data: { name: marker, brandName: 'Test Integrators' },
  });
  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: `${marker}@test.local`,
      name: 'Estimator',
      role: Role.CONTROLS_ENGINEER,
      passwordHash: await hashPassword(password),
    },
  });
  for (const t of STARTER_TEMPLATES) {
    await prisma.effortTemplate.create({ data: { ...t, tenantId: tenant.id } });
  }

  const login = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: user.email, password }),
  });
  tok = ((await login.json()) as { accessToken: string }).accessToken;

  const estimator = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: `estimator-${marker}@test.local`,
      name: 'Priya',
      role: Role.ESTIMATOR,
      passwordHash: await hashPassword(password),
    },
  });
  const estimatorLogin = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: estimator.email, password }),
  });
  estimatorTok = ((await estimatorLogin.json()) as { accessToken: string }).accessToken;

  const opportunity = await prisma.opportunity.create({
    data: {
      tenantId: tenant.id,
      name: `${marker} line`,
      customerName: 'Test Foods',
      facilityName: 'Plant 9',
      proposalType: ProposalType.FIXED_PRICE,
      shutdownRequirementHours: 12,
      createdBy: user.id,
    },
  });
  opportunityId = opportunity.id;

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

  const run = await call(`/opportunities/${opportunityId}/analyses`, {
    method: 'POST',
    body: '{}',
  });
  assert.equal(run.status, 201, `analysis failed: ${await run.text()}`);
});

after(async () => {
  await app?.close();
  await prisma.tenant.deleteMany({ where: { name: marker } });
  await prisma.$disconnect();
});

async function estimate(): Promise<Estimate> {
  const res = await call(`/opportunities/${opportunityId}/estimate`);
  assert.equal(res.status, 200);
  return (await res.json()) as Estimate;
}

test('the IIM rewrite is priced as two instructions, not as every finding that shares the package', async () => {
  const e = await estimate();
  const line = e.lines.find(
    (l) => l.workPackageCode === 'UNSUPPORTED_INSTRUCTION_REWRITE' && l.unitType === 'INSTRUCTION',
  );
  assert.ok(line, 'the IIM rewrite line is missing');
  assert.equal(line.quantity, 2);
  // 2 instructions x 2-6 h. Anything near 13 units means unit mixing is back.
  assert.equal(line.minHours, 4);
  assert.equal(line.maxHours, 12);
});

test('no work package silently loses its units', async () => {
  const e = await estimate();
  // DISCOVERY has no template on purpose: its size is exactly what is unknown.
  const unexpected = e.unpriced.filter((u) => u.workPackageCode !== 'DISCOVERY');
  assert.deepEqual(
    unexpected.map((u) => `${u.workPackageCode}|${u.unitType}`),
    [],
    'starter templates have drifted from the rule pack; this scope would go unpriced',
  );
  assert.ok(e.unpriced.some((u) => u.workPackageCode === 'DISCOVERY'));
});

test('the range is arithmetic, reproducible, and carries the org allowance', async () => {
  const a = await estimate();
  const b = await estimate();
  assert.deepEqual(a, b, 'the same analysis and templates must give the same range');

  const min = a.lines.reduce((n, l) => n + l.minHours, 0);
  const max = a.lines.reduce((n, l) => n + l.maxHours, 0);
  assert.equal(Math.round(a.totals.minHours * 100) / 100, Math.round(min * 100) / 100);
  assert.equal(Math.round(a.totals.maxHours * 100) / 100, Math.round(max * 100) / 100);
  assert.ok(a.totals.maxHoursWithAllowance > a.totals.maxHours);
  assert.ok(a.totals.minHours < a.totals.maxHours);
});

test('unknowns never become hours', async () => {
  const e = await estimate();
  assert.ok(e.allowances.length > 0);
  // No line may be attributed to a work package that only unevidenced scope
  // generates. HMI effort in particular is a SPEC 63 failure condition.
  assert.ok(!e.lines.some((l) => /HMI|DRIVE|SAFETY/i.test(l.workPackageCode)));
  assert.ok(e.caveats.some((c) => c.includes('NOT PRICED')));
  assert.ok(e.caveats.some((c) => c.toLowerCase().includes('fixed-price readiness is not ready')));
});

test('a changed template changes the range, and only through the organization', async () => {
  const before = await estimate();
  // A controls engineer may not rewrite the organization's rates.
  const refused = await call('/effort-templates', {
    method: 'PUT',
    body: JSON.stringify({ templates: [] }),
  });
  assert.equal(refused.status, 403);

  const put = await fetch(`${base}/effort-templates`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${estimatorTok}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      templates: [
        {
          workPackageCode: 'PID_VALIDATION',
          unitType: 'LOOP',
          role: 'CONTROLS_ENGINEER',
          minHoursPerUnit: 30,
          maxHoursPerUnit: 30,
          complexityFactor: 1,
        },
      ],
    }),
  });
  assert.equal(put.status, 200);
  const after = await estimate();
  const line = after.lines.find((l) => l.workPackageCode === 'PID_VALIDATION');
  assert.equal(line!.minHours, 90); // 3 loops x 30 h
  assert.ok(after.totals.minHours > before.totals.minHours);
});

test('all three deliverables generate, and none invents HMI effort', async () => {
  for (const kind of [
    'ENGINEERING_PREFLIGHT',
    'PROPOSAL_INPUT_PACKAGE',
    'CUSTOMER_INFORMATION_REQUEST',
  ]) {
    const res = await call(`/opportunities/${opportunityId}/reports`, {
      method: 'POST',
      body: JSON.stringify({ kind }),
    });
    const payload = await res.text();
    assert.equal(res.status, 201, `${kind} failed: ${payload}`);
    const report = JSON.parse(payload) as { id: string; sha256: string };

    const view = await call(`/reports/${report.id}`);
    assert.equal(view.status, 200);
    const html = await view.text();
    assert.equal(createHash('sha256').update(Buffer.from(html, 'utf8')).digest('hex'), report.sha256);
    assert.match(html, /Test Integrators/);

    if (kind === 'ENGINEERING_PREFLIGHT') {
      assert.match(html, /1747-L553/);
      assert.match(html, /SW-003/);
      assert.match(html, /NOT READY/);
    }
    if (kind === 'PROPOSAL_INPUT_PACKAGE') {
      assert.match(html, /CANDIDATE — NOT RELEASED FOR PROCUREMENT/);
      // This opportunity has no exclusion recorded, so the package must SAY
      // nothing is excluded rather than leave the section out. An absent
      // section reads as an oversight; a stated absence is a commitment.
      assert.match(html, /No exclusion has been approved. Nothing is excluded from this scope\./);
      assert.match(html, /None recorded\. Nothing in this package rests on a stated assumption\./);
      // SPEC 28: a scope item must trace back to the rule and evidence.
      assert.match(html, /RA-2026\.08::/);
    }
    if (kind === 'CUSTOMER_INFORMATION_REQUEST') {
      assert.match(html, /REQUIRED FOR FIXED PRICE/);
      assert.match(html, /HMI/);
    }
    // No deliverable may state an hour figure for unevidenced HMI work.
    assert.ok(!/HMI[^<]*\b\d+(\.\d+)?\s*h\b/i.test(html), `${kind} attributes hours to HMI`);
  }
});

test('a report is immutable: regenerating creates a new row, never a rewrite', async () => {
  const first = (await (
    await call(`/opportunities/${opportunityId}/reports`, {
      method: 'POST',
      body: JSON.stringify({ kind: 'ENGINEERING_PREFLIGHT' }),
    })
  ).json()) as { id: string };
  const second = (await (
    await call(`/opportunities/${opportunityId}/reports`, {
      method: 'POST',
      body: JSON.stringify({ kind: 'ENGINEERING_PREFLIGHT' }),
    })
  ).json()) as { id: string };
  assert.notEqual(first.id, second.id);
  const list = (await (await call(`/opportunities/${opportunityId}/reports`)).json()) as any[];
  assert.ok(list.length >= 2);
  // The earlier document is still readable byte for byte.
  assert.equal((await call(`/reports/${first.id}`)).status, 200);
});
