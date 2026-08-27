/**
 * Malware scanning (MASTER SPEC 12).
 *
 *   npm run build && node --test dist/scanner.test.js
 *
 * The clamd INSTREAM protocol is hand-written, so it is tested against a stub
 * daemon that asserts the exact framing. The property that matters most is
 * that every failure path returns UNAVAILABLE: a scanner that cannot answer
 * has not cleared anything, and CLEAN must never be inferred from silence.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer, type Server } from 'node:net';
import { parseReply, scanBuffer, type ScannerConfig } from './scanner';

/// The industry-standard antivirus test string. Harmless by construction: it is
/// not malware, it is the agreed-on thing every scanner promises to flag.
const EICAR = Buffer.from(
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
  'ascii',
);

interface Stub {
  server: Server;
  port: number;
  received: Buffer[];
  frames: number[];
}

/// A clamd that answers whatever the test tells it to, and records the framing
/// it was sent so the protocol itself can be asserted.
function stubClamd(reply: string | null, opts: { hang?: boolean } = {}): Promise<Stub> {
  const received: Buffer[] = [];
  const frames: number[] = [];
  const server = createServer((socket) => {
    let buffer = Buffer.alloc(0);
    let sawCommand = false;
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!sawCommand) {
        const zero = buffer.indexOf(0);
        if (zero === -1) return;
        received.push(buffer.subarray(0, zero));
        buffer = buffer.subarray(zero + 1);
        sawCommand = true;
      }
      // Length-prefixed chunks until a zero-length frame terminates the stream.
      for (;;) {
        if (buffer.length < 4) return;
        const size = buffer.readUInt32BE(0);
        if (size === 0) {
          buffer = buffer.subarray(4);
          if (opts.hang) return;
          if (reply !== null) socket.write(reply);
          socket.end();
          return;
        }
        if (buffer.length < 4 + size) return;
        frames.push(size);
        received.push(buffer.subarray(4, 4 + size));
        buffer = buffer.subarray(4 + size);
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as { port: number }).port, received, frames });
    });
  });
}

function config(port: number, overrides: Partial<ScannerConfig> = {}): ScannerConfig {
  return { host: '127.0.0.1', port, timeoutMs: 2000, chunkBytes: 64 * 1024, ...overrides };
}

let stubs: Stub[] = [];
before(() => {
  stubs = [];
});
after(async () => {
  await Promise.all(stubs.map((s) => new Promise((r) => s.server.close(r))));
});

async function withStub(reply: string | null, opts?: { hang?: boolean }) {
  const stub = await stubClamd(reply, opts);
  stubs.push(stub);
  return stub;
}

test('a clean file comes back CLEAN, framed the way clamd expects', async () => {
  const stub = await withStub('stream: OK\0');
  const payload = Buffer.from('SOR XIC I:1/0 OTE O:4/0 EOR\n');
  const result = await scanBuffer(payload, config(stub.port));

  assert.equal(result.status, 'CLEAN');
  assert.equal(stub.received[0].toString(), 'zINSTREAM');
  assert.deepEqual(stub.frames, [payload.length]);
  assert.ok(Buffer.concat(stub.received.slice(1)).equals(payload), 'the bytes must arrive intact');
});

test('a large file is split into length-prefixed chunks', async () => {
  const stub = await withStub('stream: OK\0');
  const payload = Buffer.alloc(1000, 0x41);
  const result = await scanBuffer(payload, config(stub.port, { chunkBytes: 256 }));

  assert.equal(result.status, 'CLEAN');
  assert.deepEqual(stub.frames, [256, 256, 256, 232]);
  assert.ok(Buffer.concat(stub.received.slice(1)).equals(payload));
});

test('EICAR comes back INFECTED with the signature', async () => {
  const stub = await withStub('stream: Win.Test.EICAR_HDB-1 FOUND\0');
  const result = await scanBuffer(EICAR, config(stub.port));

  assert.equal(result.status, 'INFECTED');
  assert.equal(result.signature, 'Win.Test.EICAR_HDB-1');
});

test('an unreachable daemon fails closed', async () => {
  // Port 1 is reserved and nothing listens on it.
  const result = await scanBuffer(Buffer.from('x'), config(1, { timeoutMs: 1500 }));
  assert.equal(result.status, 'UNAVAILABLE');
  assert.notEqual(result.status, 'CLEAN');
  assert.ok(result.detail);
});

test('a daemon that never answers fails closed', async () => {
  const stub = await withStub(null, { hang: true });
  const result = await scanBuffer(Buffer.from('x'), config(stub.port, { timeoutMs: 300 }));
  assert.equal(result.status, 'UNAVAILABLE');
  assert.match(result.detail!, /did not answer/);
});

test('a daemon that hangs up without answering fails closed', async () => {
  const stub = await withStub('');
  const result = await scanBuffer(Buffer.from('x'), config(stub.port));
  assert.equal(result.status, 'UNAVAILABLE');
  assert.match(result.detail!, /without answering/);
});

test('no configured scanner is UNAVAILABLE, not CLEAN', async () => {
  const result = await scanBuffer(Buffer.from('x'), {
    host: undefined,
    port: 3310,
    timeoutMs: 1000,
    chunkBytes: 1024,
  });
  assert.equal(result.status, 'UNAVAILABLE');
  assert.match(result.detail!, /no scanner configured/);
});

test('clamd errors and size limits are never read as clean', () => {
  for (const raw of [
    'INSTREAM size limit exceeded. ERROR\0',
    'ERROR\0',
    'UNKNOWN COMMAND\0',
    '\0',
    '',
  ]) {
    assert.equal(parseReply(raw).status, 'UNAVAILABLE', `${raw.trim()} must not read as clean`);
  }
  assert.equal(parseReply('stream: OK\0').status, 'CLEAN');
  assert.equal(parseReply('stream: Eicar-Signature FOUND\0').status, 'INFECTED');
});
