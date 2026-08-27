/**
 * Artifact intake (MASTER SPEC 11/12) end to end over HTTP multipart.
 *
 *   npm run build && node --test dist/uploads.test.js
 *
 * The scanning gate is the point of this file: an artifact that has not been
 * scanned must block analysis, and that must be the default rather than a
 * setting somebody remembers to switch on.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import multipart from '@fastify/multipart';
import { PrismaClient, ProposalType, Role } from '@prisma/client';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { AppModule } from './app.module';
import { MAX_ARTIFACT_BYTES, storageRoot } from './artifacts';
import { hashPassword } from './auth';

const prisma = new PrismaClient();
let app: NestFastifyApplication;
let base: string;
let tok: string;
let viewerTok: string;
let opportunityId: string;

const marker = `uploads-test-${process.pid}`;
const password = 'uploads-test-password';
const GOLDEN = resolve(process.cwd(), '..', '..', 'golden', 'opportunities', 'GO-001-PKG-LINE-04');

async function login(email: string) {
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return ((await res.json()) as { accessToken: string }).accessToken;
}

async function upload(
  name: string,
  bytes: Buffer | Uint8Array,
  opts: { artifactType?: string; as?: string } = {},
) {
  const form = new FormData();
  if (opts.artifactType) form.append('artifactType', opts.artifactType);
  form.append('file', new Blob([bytes as Uint8Array]), name);
  return fetch(`${base}/opportunities/${opportunityId}/artifacts`, {
    method: 'POST',
    headers: { authorization: `Bearer ${opts.as ?? tok}` },
    body: form,
  });
}

before(async () => {
  app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: false,
  });
  await app.register(multipart as any, { limits: { fileSize: MAX_ARTIFACT_BYTES, files: 1 } });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  base = `${await app.getUrl()}/api`;

  const tenant = await prisma.tenant.create({ data: { name: marker } });
  const engineer = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: `engineer-${marker}@test.local`,
      name: 'Engineer',
      role: Role.CONTROLS_ENGINEER,
      passwordHash: await hashPassword(password),
    },
  });
  const viewer = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: `viewer-${marker}@test.local`,
      name: 'Viewer',
      role: Role.VIEWER,
      passwordHash: await hashPassword(password),
    },
  });
  tok = await login(engineer.email);
  viewerTok = await login(viewer.email);

  const opportunity = await prisma.opportunity.create({
    data: {
      tenantId: tenant.id,
      name: `${marker} line`,
      customerName: 'Upload Foods',
      facilityName: 'Plant 4',
      proposalType: ProposalType.FIXED_PRICE,
      createdBy: engineer.id,
    },
  });
  opportunityId = opportunity.id;
});

after(async () => {
  await app?.close();
  await prisma.tenant.deleteMany({ where: { name: marker } });
  await prisma.$disconnect();
});

test('a PLC source uploads, is hashed, and is stored content-addressed', async () => {
  const bytes = await readFile(join(GOLDEN, 'artifacts', 'PKG04.SLC'));
  const res = await upload('PKG04.SLC', bytes);
  const payload = await res.text();
  assert.equal(res.status, 201, payload);
  const artifact = JSON.parse(payload) as any;

  assert.equal(artifact.artifactType, 'PLC_SOURCE');
  assert.equal(artifact.size, bytes.length);
  assert.equal(artifact.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.ok(artifact.storageLocation.includes(artifact.sha256));

  // The stored object is the uploaded bytes, unmodified.
  const stored = await readFile(join(storageRoot(), artifact.storageLocation));
  assert.ok(stored.equals(bytes));
});

test('the same bytes uploaded twice resolve to one artifact', async () => {
  const bytes = await readFile(join(GOLDEN, 'artifacts', 'PKG04.SLC'));
  const again = await upload('PKG04-copy.SLC', bytes);
  assert.equal(again.status, 201);
  const rows = await prisma.artifact.findMany({ where: { opportunityId } });
  assert.equal(rows.filter((r) => r.artifactType === 'PLC_SOURCE').length, 1);
});

test('a declared type overrides what the extension suggests', async () => {
  const res = await upload('NETWORK_SKETCH.pdf', Buffer.from('%PDF-1.4 fake'), {
    artifactType: 'NETWORK_DRAWING',
  });
  const payload = await res.text();
  assert.equal(res.status, 201, payload);
  assert.equal((JSON.parse(payload) as any).artifactType, 'NETWORK_DRAWING');
});

test('archives, executables and unknown extensions are refused', async () => {
  for (const name of ['payload.zip', 'tool.exe', 'script.ps1', 'notes.docx']) {
    const res = await upload(name, Buffer.from('anything'));
    assert.equal(res.status, 400, `${name} should be refused`);
    assert.match(((await res.json()) as any).message, /not accepted/);
  }
});

test('a native project file is refused with the export procedure attached', async () => {
  // OLE2 magic: what a real .RSS starts with.
  const rss = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), Buffer.alloc(32)]);
  const res = await upload('LINE04.RSS', rss);
  assert.equal(res.status, 400);
  const message = ((await res.json()) as any).message;
  assert.match(message, /A\.B\. 6200/);
  assert.match(message, /Complete Program Save/);
});

test('an empty file is refused', async () => {
  const res = await upload('empty.csv', Buffer.alloc(0));
  assert.equal(res.status, 400);
});

test('a viewer cannot upload', async () => {
  const res = await upload('PKG04_SYMBOLS.CSV', Buffer.from('ADDRESS,SYMBOL\n'), {
    as: viewerTok,
  });
  assert.equal(res.status, 403);
});

test('analysis refuses to consume artifacts that have not cleared scanning', async () => {
  const rows = await prisma.artifact.findMany({ where: { opportunityId } });
  assert.ok(rows.length > 0);
  assert.ok(
    rows.every((r) => r.processingStatus === 'RECEIVED'),
    'uploads must not be marked scanned by default',
  );

  const res = await fetch(`${base}/opportunities/${opportunityId}/analyses`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(res.status, 400);
  assert.match(((await res.json()) as any).message, /malware scanning/);
});

test('once scanning clears the artifacts, the same analysis runs', async () => {
  await prisma.artifact.updateMany({
    where: { opportunityId },
    data: { processingStatus: 'SCANNED' },
  });
  const res = await fetch(`${base}/opportunities/${opportunityId}/analyses`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
    body: '{}',
  });
  const payload = await res.text();
  assert.equal(res.status, 201, payload);
  const analysis = JSON.parse(payload) as any;
  assert.equal(analysis.result.system_model.processor, '1747-L553');
});

test('every upload is recorded in the audit trail', async () => {
  const events = await prisma.auditEvent.findMany({
    where: { action: 'artifact.uploaded' },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  const mine = events.filter((e) => (e.detail as any)?.opportunityId === opportunityId);
  assert.ok(mine.length >= 2);
  assert.ok(mine.every((e) => typeof (e.detail as any).sha256 === 'string'));
});
