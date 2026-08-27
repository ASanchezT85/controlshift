import {
  BadRequestException,
  Controller,
  Get,
  Injectable,
  Module,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ArtifactType, ProcessingStatus, Role } from '@prisma/client';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { AuditModule, AuditService } from './audit';
import { AuthGuard, AuthModule, CurrentUser, Principal, Roles } from './auth';
import { OpportunitiesModule, OpportunitiesService } from './opportunities';
import { PrismaService } from './prisma.service';

/// SPEC 12: size ceiling, extension allowlist, hash, immutable store.
export const MAX_ARTIFACT_BYTES = Number(process.env.MAX_ARTIFACT_BYTES ?? 100 * 1024 * 1024);

const ALLOWED: Record<string, ArtifactType> = {
  slc: ArtifactType.PLC_SOURCE,
  csv: ArtifactType.SYMBOL_DATABASE,
  xlsx: ArtifactType.IO_LIST,
  xls: ArtifactType.IO_LIST,
  pdf: ArtifactType.ELECTRICAL_DRAWING,
  txt: ArtifactType.CUSTOMER_NOTE,
  jpg: ArtifactType.PHOTO,
  jpeg: ArtifactType.PHOTO,
  png: ArtifactType.PHOTO,
};

// Archives are refused outright in V1 rather than unpacked. There is no
// decompression path, so there is no archive bomb to bound.
const REFUSED = ['zip', 'rar', '7z', 'tar', 'gz', 'exe', 'dll', 'bat', 'ps1', 'sh', 'js'];

/// Files a customer sends in good faith that we cannot read. A bare "not
/// accepted" wastes a round trip; each of these knows what to ask for instead.
const GUIDANCE: Record<string, string> = {
  rss: 'this is the native RSLogix 500 project. Re-export it: File > Save As > Export Database > A.B. 6200 > .SLC, with Complete Program Save and all export options',
  rsp: 'this is a native RSLogix 5 project. V1 supports SLC 500 only',
  acd: 'this is a Studio 5000 project. V1 analyzes the SOURCE platform, an SLC 500 export',
  sys6: 'the .SYS6 symbol database is useful, but upload it alongside the .SLC program export, not instead of it',
};

/// Always absolute: the engine runs from a temp directory and joins these
/// paths, so a relative root would resolve against the wrong place.
export function storageRoot(): string {
  return resolve(process.env.STORAGE_ROOT ?? join(process.cwd(), 'storage'));
}

/// Malware scanning (SPEC 12). No scanner is wired in V1. Rather than pretend
/// a file is clean, an unscanned artifact stays RECEIVED and analysis refuses
/// to consume it unless the operator explicitly accepts the risk in a
/// development environment.
// ponytail: env-gated stub, not a plugin architecture. Wire a real ClamAV/
// vendor scan here when the first customer artifact arrives.
export function scanStatus(): ProcessingStatus {
  return process.env.ALLOW_UNSCANNED_ARTIFACTS === 'true'
    ? ProcessingStatus.SCANNED
    : ProcessingStatus.RECEIVED;
}

@Injectable()
export class ArtifactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly opportunities: OpportunitiesService,
    private readonly audit: AuditService,
  ) {}

  async upload(
    user: Principal,
    opportunityId: string,
    filename: string,
    mediaType: string,
    body: Buffer,
    declaredType?: string,
  ) {
    await this.opportunities.get(user.tenantId, opportunityId);

    if (body.length === 0) throw new BadRequestException('empty file');
    if (body.length > MAX_ARTIFACT_BYTES) {
      throw new BadRequestException(`file exceeds ${MAX_ARTIFACT_BYTES} bytes`);
    }
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    if (REFUSED.includes(ext)) {
      throw new BadRequestException(`.${ext} files are not accepted`);
    }
    if (GUIDANCE[ext]) {
      throw new BadRequestException(`.${ext} files are not accepted: ${GUIDANCE[ext]}`);
    }
    const inferred = ALLOWED[ext];
    if (!inferred) throw new BadRequestException(`.${ext} files are not accepted`);
    const artifactType =
      declaredType && declaredType in ArtifactType
        ? (declaredType as ArtifactType)
        : inferred;

    const sha256 = createHash('sha256').update(body).digest('hex');
    const existing = await this.prisma.artifact.findFirst({
      where: { opportunityId, sha256 },
    });
    if (existing) return existing;

    // Content-addressed and write-once: an original is never overwritten
    // (SPEC 11). Two uploads of identical bytes resolve to the same object.
    const relative = join('original', user.tenantId, sha256.slice(0, 2), sha256);
    const absolute = join(storageRoot(), relative);
    if (!existsSync(absolute)) {
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, body, { flag: 'wx' }).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== 'EEXIST') throw e;
      });
    }

    const artifact = await this.prisma.artifact.create({
      data: {
        opportunityId,
        originalFilename: filename,
        mediaType: mediaType || 'application/octet-stream',
        artifactType,
        sha256,
        size: body.length,
        storageLocation: relative.split('\\').join('/'),
        processingStatus: scanStatus(),
      },
    });
    await this.audit.record(user.tenantId, user.userId, 'artifact.uploaded', 'Artifact', artifact.id, {
      opportunityId,
      filename,
      sha256,
      size: body.length,
    });
    return artifact;
  }

  async list(tenantId: string, opportunityId: string) {
    await this.opportunities.get(tenantId, opportunityId);
    return this.prisma.artifact.findMany({
      where: { opportunityId },
      orderBy: { createdAt: 'asc' },
    });
  }
}

@Controller('opportunities/:id/artifacts')
@UseGuards(AuthGuard)
export class ArtifactsController {
  constructor(private readonly svc: ArtifactsService) {}

  @Get()
  list(@CurrentUser() user: Principal, @Param('id') id: string) {
    return this.svc.list(user.tenantId, id);
  }

  @Post()
  @Roles(Role.ORG_ADMIN, Role.CONTROLS_ENGINEER, Role.PROJECT_MANAGER)
  async upload(@CurrentUser() user: Principal, @Param('id') id: string, @Req() req: any) {
    const file = await req.file({ limits: { fileSize: MAX_ARTIFACT_BYTES } });
    if (!file) throw new BadRequestException('no file in request');
    const body = await file.toBuffer();
    return this.svc.upload(
      user,
      id,
      file.filename,
      file.mimetype,
      body,
      file.fields?.artifactType?.value,
    );
  }
}

@Module({
  imports: [AuthModule, AuditModule, OpportunitiesModule],
  controllers: [ArtifactsController],
  providers: [ArtifactsService, PrismaService],
  exports: [ArtifactsService],
})
export class ArtifactsModule {}
