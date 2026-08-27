import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  InternalServerErrorException,
  Module,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ProcessingStatus, Role } from '@prisma/client';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { AuditModule, AuditService } from './audit';
import { AuthGuard, AuthModule, CurrentUser, Principal, Roles } from './auth';
import { OpportunitiesModule, OpportunitiesService } from './opportunities';
import { PrismaService } from './prisma.service';
import { storageRoot } from './artifacts';

const execFileAsync = promisify(execFile);

const STRATEGIES = ['PRESERVE_1746_IO', 'COMPACT_5000_IO', 'FULL_MODERNIZATION'] as const;

class RunAnalysisDto {
  @IsOptional() @IsIn(STRATEGIES as unknown as string[]) targetStrategy?: string;
  @IsOptional() @IsString() rulePack?: string;
}

class ReviewDto {
  @IsString() findingId: string;
  @IsIn(['ACKNOWLEDGE', 'ACCEPT', 'REJECT', 'RESOLVE', 'OVERRIDE']) action: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() overrideState?: string;
}

export function engineBinary(): string {
  if (process.env.CS_ANALYZE_BIN) return process.env.CS_ANALYZE_BIN;
  const exe = process.platform === 'win32' ? 'csanalyze.exe' : 'csanalyze';
  return resolve(process.cwd(), '..', '..', 'target', 'release', exe);
}

export function rulePackDir(): string {
  return process.env.RULEPACK_DIR ?? resolve(process.cwd(), '..', '..', 'rulepacks', 'rockwell');
}

@Injectable()
export class AnalysesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly opportunities: OpportunitiesService,
    private readonly audit: AuditService,
  ) {}

  async get(tenantId: string, opportunityId: string, analysisId: string) {
    await this.opportunities.get(tenantId, opportunityId);
    const analysis = await this.prisma.analysis.findFirst({
      where: { id: analysisId, opportunityId },
      include: { reviews: { orderBy: { createdAt: 'asc' } } },
    });
    if (!analysis) throw new NotFoundException('analysis not found');
    return analysis;
  }

  async latest(tenantId: string, opportunityId: string) {
    await this.opportunities.get(tenantId, opportunityId);
    const analysis = await this.prisma.analysis.findFirst({
      where: { opportunityId, failed: false, NOT: { result: undefined } },
      orderBy: { startedAt: 'desc' },
      include: { reviews: { orderBy: { createdAt: 'asc' } } },
    });
    if (!analysis) throw new NotFoundException('this opportunity has no completed analysis');
    return analysis;
  }

  /// Runs the deterministic engine out of process (MASTER SPEC 46). The engine
  /// receives absolute paths to immutable originals and can only read them.
  async run(user: Principal, opportunityId: string, dto: RunAnalysisDto) {
    const opportunity = await this.opportunities.get(user.tenantId, opportunityId);
    const artifacts = await this.prisma.artifact.findMany({ where: { opportunityId } });

    const source = artifacts.filter((a) => a.artifactType === 'PLC_SOURCE');
    if (source.length === 0) {
      throw new BadRequestException('no PLC_SOURCE artifact: nothing can be reconstructed');
    }
    if (source.length > 1) {
      throw new BadRequestException('V1 analyzes one PLC_SOURCE per opportunity');
    }
    const unscanned = artifacts.filter((a) => a.processingStatus === ProcessingStatus.RECEIVED);
    if (unscanned.length) {
      throw new BadRequestException(
        `${unscanned.length} artifact(s) have not cleared malware scanning; ` +
          'analysis refuses to consume unscanned artifacts',
      );
    }

    const rulePack = dto.rulePack ?? process.env.DEFAULT_RULE_PACK ?? 'RA-2026.08';
    const targetStrategy = dto.targetStrategy ?? 'COMPACT_5000_IO';

    const request = {
      schema_version: '1.0.0',
      opportunity_id: opportunityId,
      target_strategy: targetStrategy,
      target_controller: opportunity.requestedTarget,
      proposal_type: opportunity.proposalType,
      shutdown_hours: opportunity.shutdownRequirementHours ?? null,
      engineering_review_complete: opportunity.engineeringReviewComplete,
      shutdown_feasible: opportunity.shutdownFeasible,
      rule_pack: rulePack,
      artifacts: artifacts.map((a) => ({
        path: join(storageRoot(), a.storageLocation),
        artifact_type: a.artifactType,
        sha256: a.sha256,
        size: a.size,
      })),
    };

    const workdir = await mkdtemp(join(tmpdir(), 'controlshift-'));
    try {
      const requestPath = join(workdir, 'request.json');
      await writeFile(requestPath, JSON.stringify(request));
      const { stdout } = await execFileAsync(
        engineBinary(),
        ['--request', requestPath, '--rulepacks', rulePackDir()],
        { maxBuffer: 256 * 1024 * 1024, timeout: 120_000 },
      );
      const result = JSON.parse(stdout);
      const analysis = await this.prisma.analysis.create({
        data: {
          opportunityId,
          schemaVersion: result.versions.schema_version,
          parserVersion: result.versions.parser_version,
          irSchemaVersion: result.versions.ir_schema_version,
          analysisEngineVersion: result.versions.analysis_engine_version,
          rulePackVersion: result.versions.rule_pack_version,
          targetStrategy,
          finishedAt: new Date(),
          result,
        },
      });
      await this.prisma.opportunity.update({
        where: { id: opportunityId },
        data: { status: 'ANALYZED' },
      });
      await this.audit.record(user.tenantId, user.userId, 'analysis.completed', 'Analysis', analysis.id, {
        opportunityId,
        rulePack: result.versions.rule_pack_version,
        findingCount: result.findings.length,
        fixedPrice: result.quote_readiness.fixed_price,
      });
      return analysis;
    } catch (e: any) {
      const failure = String(e?.stderr || e?.message || e).slice(0, 2000);
      const analysis = await this.prisma.analysis.create({
        data: {
          opportunityId,
          schemaVersion: '1.0.0',
          parserVersion: 'unknown',
          irSchemaVersion: 'unknown',
          analysisEngineVersion: 'unknown',
          rulePackVersion: rulePack,
          targetStrategy,
          finishedAt: new Date(),
          failed: true,
          failure,
        },
      });
      await this.audit.record(user.tenantId, user.userId, 'analysis.failed', 'Analysis', analysis.id, {
        opportunityId,
        failure,
      });
      throw new InternalServerErrorException(`analysis failed: ${failure}`);
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  }

  /// A review never rewrites the finding. It is recorded beside it (SPEC 36).
  async review(user: Principal, opportunityId: string, analysisId: string, dto: ReviewDto) {
    const analysis = await this.get(user.tenantId, opportunityId, analysisId);
    const result = analysis.result as any;
    const known = result?.findings?.some((f: any) => f.id === dto.findingId);
    if (!known) throw new NotFoundException(`finding ${dto.findingId} is not in this analysis`);
    if (dto.action === 'OVERRIDE' && !dto.reason) {
      throw new BadRequestException('an override requires a reason');
    }

    const review = await this.prisma.findingReview.create({
      data: {
        analysisId,
        findingId: dto.findingId,
        action: dto.action as any,
        reason: dto.reason,
        overrideState: dto.overrideState,
        reviewerId: user.userId,
      },
    });
    await this.audit.record(
      user.tenantId,
      user.userId,
      `finding.${dto.action.toLowerCase()}`,
      'Finding',
      dto.findingId,
      { analysisId, reason: dto.reason, overrideState: dto.overrideState },
    );
    return review;
  }
}

@Controller('opportunities/:id/analyses')
@UseGuards(AuthGuard)
export class AnalysesController {
  constructor(private readonly svc: AnalysesService) {}

  @Post()
  @Roles(Role.ORG_ADMIN, Role.CONTROLS_ENGINEER)
  run(@CurrentUser() user: Principal, @Param('id') id: string, @Body() dto: RunAnalysisDto) {
    return this.svc.run(user, id, dto);
  }

  @Get('latest')
  latest(@CurrentUser() user: Principal, @Param('id') id: string) {
    return this.svc.latest(user.tenantId, id);
  }

  @Get(':analysisId')
  get(
    @CurrentUser() user: Principal,
    @Param('id') id: string,
    @Param('analysisId') analysisId: string,
  ) {
    return this.svc.get(user.tenantId, id, analysisId);
  }

  @Post(':analysisId/reviews')
  @Roles(Role.ORG_ADMIN, Role.CONTROLS_ENGINEER)
  review(
    @CurrentUser() user: Principal,
    @Param('id') id: string,
    @Param('analysisId') analysisId: string,
    @Body() dto: ReviewDto,
  ) {
    return this.svc.review(user, id, analysisId, dto);
  }
}

@Module({
  imports: [AuthModule, AuditModule, OpportunitiesModule],
  controllers: [AnalysesController],
  providers: [AnalysesService, PrismaService],
})
export class AnalysesModule {}
