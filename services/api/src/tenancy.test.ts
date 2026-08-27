/**
 * Tenant isolation and RBAC (MASTER SPEC 51/52) against a real database.
 *
 *   npm run build && node --test dist/tenancy.test.js
 *
 * Creates two tenants, then proves tenant B cannot see, read, analyze or
 * review tenant A's opportunity, and that a Viewer cannot mutate anything.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient, ProposalType, Role } from '@prisma/client';
import { AppModule } from './app.module';
import { hashPassword } from './auth';

const prisma = new PrismaClient();
let app: NestFastifyApplication;
let base: string;

const marker = `tenancy-test-${process.pid}`;
const password = 'tenancy-test-password';

async function makeTenant(label: string, role: Role) {
  const tenant = await prisma.tenant.create({ data: { name: `${marker}-${label}` } });
  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: `${label}-${marker}@test.local`,
      name: label,
      role,
      passwordHash: await hashPassword(password),
    },
  });
  return { tenant, user };
}

async function token(email: string) {
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(res.status, 201, `login failed for ${email}`);
  return ((await res.json()) as { accessToken: string }).accessToken;
}

function call(path: string, tok: string, init: RequestInit = {}) {
  return fetch(`${base}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${tok}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });
}

let a: Awaited<ReturnType<typeof makeTenant>>;
let b: Awaited<ReturnType<typeof makeTenant>>;
let viewer: Awaited<ReturnType<typeof makeTenant>>;
let opportunityId: string;

before(async () => {
  app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: false,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  base = `${await app.getUrl()}/api`;

  a = await makeTenant('alpha', Role.CONTROLS_ENGINEER);
  b = await makeTenant('beta', Role.CONTROLS_ENGINEER);
  viewer = await makeTenant('viewer', Role.VIEWER);

  const opportunity = await prisma.opportunity.create({
    data: {
      tenantId: a.tenant.id,
      name: `${marker} alpha line`,
      customerName: 'Alpha Foods',
      facilityName: 'Plant 1',
      proposalType: ProposalType.FIXED_PRICE,
      createdBy: a.user.id,
    },
  });
  opportunityId = opportunity.id;
});

after(async () => {
  await app?.close();
  await prisma.tenant.deleteMany({ where: { name: { startsWith: marker } } });
  await prisma.$disconnect();
});

test('an unauthenticated request is refused', async () => {
  const res = await fetch(`${base}/opportunities`);
  assert.equal(res.status, 401);
});

test('a tenant sees only its own opportunities', async () => {
  const listA = (await (await call('/opportunities', await token(a.user.email))).json()) as any[];
  const listB = (await (await call('/opportunities', await token(b.user.email))).json()) as any[];
  assert.ok(listA.some((o: any) => o.id === opportunityId));
  assert.ok(!listB.some((o: any) => o.id === opportunityId));
});

test("another tenant cannot read, analyze or review a foreign opportunity", async () => {
  const tok = await token(b.user.email);
  // 404, never 403: a wrong tenant must not learn that the row exists.
  assert.equal((await call(`/opportunities/${opportunityId}`, tok)).status, 404);
  assert.equal((await call(`/opportunities/${opportunityId}/artifacts`, tok)).status, 404);
  assert.equal(
    (await call(`/opportunities/${opportunityId}/analyses`, tok, { method: 'POST', body: '{}' }))
      .status,
    404,
  );
  assert.equal((await call(`/opportunities/${opportunityId}/analyses/latest`, tok)).status, 404);
});

test('a viewer cannot create an opportunity or start an analysis', async () => {
  const tok = await token(viewer.user.email);
  const create = await call('/opportunities', tok, {
    method: 'POST',
    body: JSON.stringify({
      name: `${marker} forbidden`,
      customerName: 'Nope',
      facilityName: 'Nope',
      proposalType: 'ROM',
    }),
  });
  assert.equal(create.status, 403);
  assert.equal(
    (await call(`/opportunities/${opportunityId}/analyses`, tok, { method: 'POST', body: '{}' }))
      .status,
    403,
  );
});

test('a forged token is rejected', async () => {
  const real = await token(a.user.email);
  const [header, payload] = real.split('.');
  const forged = `${header}.${payload}.not-a-real-signature`;
  assert.equal((await call('/opportunities', forged)).status, 401);
});

test('audit events never leak across tenants', async () => {
  const events = (await (await call('/audit', await token(b.user.email))).json()) as any[];
  assert.ok(Array.isArray(events));
  assert.ok(events.every((e: any) => e.tenantId === b.tenant.id));
});
