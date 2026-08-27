import { Injectable, Module } from '@nestjs/common';
import { createConnection, type Socket } from 'node:net';

/**
 * Malware scanning for the ingestion pipeline (MASTER SPEC 12).
 *
 * Speaks clamd's INSTREAM protocol directly over TCP. No dependency, and no
 * third-party service: a customer's PLC source is the one thing that must not
 * leave the deployment, so an upload-to-cloud scanner is not an option here
 * (SPEC 42).
 *
 * The rule that matters is that this **fails closed**. Every error path -
 * unreachable daemon, timeout, protocol garbage, file too large - returns
 * UNAVAILABLE, never CLEAN. A scanner that cannot answer has not cleared
 * anything.
 */

export type ScanStatus = 'CLEAN' | 'INFECTED' | 'UNAVAILABLE';

export interface ScanResult {
  status: ScanStatus;
  /// The signature clamd matched, when it found one.
  signature?: string;
  /// Why the scanner could not answer, when it could not.
  detail?: string;
}

export interface ScannerConfig {
  host?: string;
  port: number;
  timeoutMs: number;
  chunkBytes: number;
}

export function scannerConfig(): ScannerConfig {
  return {
    host: process.env.CLAMD_HOST || undefined,
    port: Number(process.env.CLAMD_PORT ?? 3310),
    timeoutMs: Number(process.env.CLAMD_TIMEOUT_MS ?? 30_000),
    // clamd's default StreamMaxLength is 25 MB; chunks are framed well under it.
    chunkBytes: Number(process.env.CLAMD_CHUNK_BYTES ?? 64 * 1024),
  };
}

/// `zINSTREAM\0`, then length-prefixed chunks, then a zero-length terminator.
/// clamd replies `stream: OK\0` or `stream: <signature> FOUND\0`.
export function scanBuffer(bytes: Buffer, config = scannerConfig()): Promise<ScanResult> {
  if (!config.host) {
    return Promise.resolve({
      status: 'UNAVAILABLE',
      detail: 'no scanner configured (CLAMD_HOST is unset)',
    });
  }

  return new Promise<ScanResult>((resolve) => {
    let settled = false;
    const done = (result: ScanResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    const socket: Socket = createConnection({ host: config.host, port: config.port });
    socket.setTimeout(config.timeoutMs);

    socket.on('timeout', () =>
      done({ status: 'UNAVAILABLE', detail: `clamd did not answer within ${config.timeoutMs} ms` }),
    );
    socket.on('error', (e) => done({ status: 'UNAVAILABLE', detail: `clamd: ${e.message}` }));

    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      for (let offset = 0; offset < bytes.length; offset += config.chunkBytes) {
        const chunk = bytes.subarray(offset, offset + config.chunkBytes);
        const header = Buffer.alloc(4);
        header.writeUInt32BE(chunk.length, 0);
        socket.write(header);
        socket.write(chunk);
      }
      socket.write(Buffer.from([0, 0, 0, 0]));
    });

    const reply: Buffer[] = [];
    socket.on('data', (d) => reply.push(d));
    socket.on('end', () => done(parseReply(Buffer.concat(reply).toString('utf8'))));
  });
}

export function parseReply(raw: string): ScanResult {
  const text = raw.replace(/\0/g, '').trim();
  if (!text) {
    return { status: 'UNAVAILABLE', detail: 'clamd closed the connection without answering' };
  }
  if (/\bOK$/.test(text)) return { status: 'CLEAN' };
  const found = /^stream:\s*(.+?)\s+FOUND$/.exec(text);
  if (found) return { status: 'INFECTED', signature: found[1] };
  // Size limits and internal errors both arrive as ERROR. Neither is clean.
  return { status: 'UNAVAILABLE', detail: `clamd said: ${text.slice(0, 200)}` };
}

@Injectable()
export class ScannerService {
  scan(bytes: Buffer): Promise<ScanResult> {
    return scanBuffer(bytes);
  }

  configured(): boolean {
    return !!scannerConfig().host;
  }
}

@Module({
  providers: [ScannerService],
  exports: [ScannerService],
})
export class ScannerModule {}
