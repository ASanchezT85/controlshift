/**
 * Assumptions and exclusions (MASTER SPEC 29/30/37).
 *
 *   npm run build && node --test dist/commercial.test.js
 *
 * The separation of duties is the point: engineering validates assumptions,
 * commerce approves exclusions, and neither role can perform the other's act.
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

const prisma = new PrismaClient();
let app: NestFastifyApplication;
let base: string;
let engineerTok: string;
let estimatorTok: string;
let opportunityId: string;

const marker = `commercial-test-${process.pid}`;
const password = 'commercial-test-password';
const GOLDEN = resolve(process.cwd(), '..', '..', 'golden', 'opportunities', 'GO-001-PKG-LINE-04');

function call(path: string, tok: string, init: RequestInit = {}) {
  return fetch(`${base}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${tok}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });
}

/// Reads the body once and hands back both forms. A Response body can only be
/// consumed a single time, and an assertion message that reads it is enough to
/// break the parse that follows.
async function read<T>(res: Response): Promise<{ status: number; text: string; data: T }> {
  const text = await res.text();
  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    data = undefined as T;
  }
  return { status: res.status, text, data };
}

async function json<T>(res: Response): Promise<T> {
  return (await read<T>(res)).data;
}

async function makeUser(label: string, role: Role, tenantId: string) {
  const user = await prisma.user.create({
    data: {
      tenantId,
      email: `${label}-${marker}@test.local`,
      name: label,
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

  const tenant = await prisma.tenant.create({
    data: { name: marker, brandName: 'Commercial Test Integrators' },
  });
  engineerTok = await makeUser('engineer', Role.CONTROLS_ENGINEER, tenant.id);
  estimatorTok = await makeUser('estimator', Role.ESTIMATOR, tenant.id);

  const creator = await prisma.user.findFirstOrThrow({
    where: { tenantId: tenant.id, role: Role.CONTROLS_ENGINEER },
  });
  const opportunity = await prisma.opportunity.create({
    data: {
      tenantId: tenant.id,
      name: `${marker} line`,
      customerName: 'Commercial Foods',
      facilityName: 'Plant 7',
      proposalType: ProposalType.FIXED_PRICE,
      shutdownRequirementHours: 12,
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

test('proposing from an analysis drafts assumptions and exclusions, approving none', async () => {
  const res = await read<any>(
    await call(`/opportunities/${opportunityId}/commercial/propose`, engineerTok, {
      method: 'POST',
      body: '{}',
    }),
  );
  assert.equal(res.status, 201, res.text);

  const { assumptions, exclusions } = await json<any>(
    await call(`/opportunities/${opportunityId}/commercial`, engineerTok),
  );
  assert.ok(assumptions.length >= 2, 'the baseline assumptions must be stated, not left implicit');
  assert.ok(exclusions.length >= 1, 'unevidenced HMI and drive scope should be proposed');
  assert.ok(
    assumptions.every((a: any) => a.validationState === 'ASSUMED'),
    'proposing must never validate',
  );
  assert.ok(
    exclusions.every((e: any) => e.approvedBy === null),
    'proposing must never approve',
  );
  // Every proposed exclusion traces to the unknown it came from.
  assert.ok(exclusions.every((e: any) => e.relatedUnknowns.length > 0));
});

test('an unknown that must be resolved is never proposed away', async () => {
  const { assumptions, exclusions } = await json<any>(
    await call(`/opportunities/${opportunityId}/commercial`, engineerTok),
  );
  const analysis = await prisma.analysis.findFirstOrThrow({
    where: { opportunityId, failed: false },
    orderBy: { startedAt: 'desc' },
  });
  const blocking = ((analysis.result as any).unknowns as any[]).filter(
    (u) => u.estimate_allowance_profile === 'RESOLVE_BEFORE_QUOTE',
  );
  assert.ok(blocking.length > 0);
  for (const u of blocking) {
    assert.ok(
      !assumptions.some((a: any) => a.sourceUnknownId === u.id),
      `${u.id} must not become an assumption`,
    );
    assert.ok(
      !exclusions.some((e: any) => e.relatedUnknowns.includes(u.id)),
      `${u.id} must not become an exclusion`,
    );
  }
});

test('proposing twice does not duplicate', async () => {
  const before = await json<any>(
    await call(`/opportunities/${opportunityId}/commercial`, engineerTok),
  );
  await call(`/opportunities/${opportunityId}/commercial/propose`, engineerTok, {
    method: 'POST',
    body: '{}',
  });
  const after = await json<any>(
    await call(`/opportunities/${opportunityId}/commercial`, engineerTok),
  );
  assert.equal(after.assumptions.length, before.assumptions.length);
  assert.equal(after.exclusions.length, before.exclusions.length);
});

test('engineering validates assumptions; commerce cannot', async () => {
  const { assumptions } = await json<any>(
    await call(`/opportunities/${opportunityId}/commercial`, engineerTok),
  );
  const target = assumptions[0];

  const refused = await call(`/assumptions/${target.id}`, estimatorTok, {
    method: 'PATCH',
    body: JSON.stringify({ validationState: 'VALIDATED' }),
  });
  assert.equal(refused.status, 403, 'an estimator may not settle a technical question');

  const ok = await call(`/assumptions/${target.id}`, engineerTok, {
    method: 'PATCH',
    body: JSON.stringify({ validationState: 'VALIDATED' }),
  });
  assert.equal(ok.status, 200);
  const updated = await json<any>(ok);
  assert.equal(updated.validationState, 'VALIDATED');
  assert.ok(updated.reviewedBy);
  assert.ok(updated.reviewedAt);
});

test('commerce approves exclusions; engineering cannot', async () => {
  const { exclusions } = await json<any>(
    await call(`/opportunities/${opportunityId}/commercial`, engineerTok),
  );
  const target = exclusions[0];

  const refused = await call(`/exclusions/${target.id}/approve`, engineerTok, {
    method: 'PATCH',
    body: '{}',
  });
  assert.equal(refused.status, 403, 'an engineer may not make the commercial call');

  const ok = await call(`/exclusions/${target.id}/approve`, estimatorTok, {
    method: 'PATCH',
    body: '{}',
  });
  assert.equal(ok.status, 200);
  const approved = await json<any>(ok);
  assert.ok(approved.approvedBy);
  assert.ok(approved.approvedAt);
});

test('a reviewed assumption and an approved exclusion cannot be deleted', async () => {
  const { assumptions, exclusions } = await json<any>(
    await call(`/opportunities/${opportunityId}/commercial`, engineerTok),
  );
  const reviewed = assumptions.find((a: any) => a.validationState !== 'ASSUMED');
  const approved = exclusions.find((e: any) => e.approvedBy);

  const a = await call(`/assumptions/${reviewed.id}`, engineerTok, { method: 'DELETE' });
  assert.equal(a.status, 400);
  assert.match((await json<any>(a)).message, /INVALIDATED/);

  const e = await call(`/exclusions/${approved.id}`, estimatorTok, { method: 'DELETE' });
  assert.equal(e.status, 400);
  assert.match((await json<any>(e)).message, /commercial output/);
});

test('an unreviewed proposal can be withdrawn', async () => {
  const created = await json<any>(
    await call(`/opportunities/${opportunityId}/exclusions`, engineerTok, {
      method: 'POST',
      body: JSON.stringify({ scopeArea: 'TEMPORARY', reason: 'added by a test' }),
    }),
  );
  const res = await call(`/exclusions/${created.id}`, engineerTok, { method: 'DELETE' });
  assert.equal(res.status, 200);
});

test('only approved exclusions shape the proposal package', async () => {
  // One approved, one still a proposal.
  await call(`/opportunities/${opportunityId}/exclusions`, engineerTok, {
    method: 'POST',
    body: JSON.stringify({
      scopeArea: 'PENDING_AREA',
      reason: 'proposed but not approved by anybody',
    }),
  });

  const res = await read<any>(
    await call(`/opportunities/${opportunityId}/reports`, estimatorTok, {
      method: 'POST',
      body: JSON.stringify({ kind: 'PROPOSAL_INPUT_PACKAGE' }),
    }),
  );
  assert.equal(res.status, 201, res.text);
  const report = res.data;
  const html = await (await call(`/reports/${report.id}`, estimatorTok)).text();

  const approvedSection = html.slice(
    html.indexOf('<h2>Exclusions</h2>'),
    html.indexOf('Proposed exclusions'),
  );
  assert.ok(!approvedSection.includes('PENDING_AREA'), 'an unapproved exclusion must not read as excluded');
  assert.match(html, /Proposed exclusions — NOT APPROVED/);
  assert.ok(html.includes('PENDING_AREA'), 'the pending proposal must still be visible');

  // The stated assumptions and their consequences reach the commercial output.
  assert.match(html, /currently running on the line/);
  assert.match(html, /VALIDATED/);
});

test('every commercial act is auditable', async () => {
  const events = await prisma.auditEvent.findMany({
    where: { action: { in: ['assumption.created', 'assumption.validated', 'exclusion.approved'] } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  const mine = events.filter((e) => (e.detail as any)?.opportunityId === opportunityId);
  for (const action of ['assumption.created', 'assumption.validated', 'exclusion.approved']) {
    assert.ok(mine.some((e) => e.action === action), `${action} is not audited`);
  }
});
