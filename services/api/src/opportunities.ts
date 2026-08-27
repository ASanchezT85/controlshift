import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ProposalType, Role } from '@prisma/client';
import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, MinLength } from 'class-validator';
import { AuditModule, AuditService } from './audit';
import { AuthGuard, AuthModule, CurrentUser, Principal, Roles } from './auth';
import { PrismaService } from './prisma.service';

class CreateOpportunityDto {
  @IsString() @MinLength(2) name: string;
  @IsString() @MinLength(2) customerName: string;
  @IsString() @MinLength(2) facilityName: string;
  @IsEnum(ProposalType) proposalType: ProposalType;
  @IsOptional() @IsNumber() shutdownRequirementHours?: number;
  @IsOptional() @IsString() commercialNotes?: string;
}

/// Commercial and engineering sign-off are separate acts by separate roles
/// (MASTER SPEC 37). Neither is ever set by the analysis engine.
class ReviewStateDto {
  @IsOptional() @IsBoolean() engineeringReviewComplete?: boolean;
  @IsOptional() @IsBoolean() shutdownFeasible?: boolean;
}

@Injectable()
export class OpportunitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string) {
    return this.prisma.opportunity.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { artifacts: true, analyses: true } } },
    });
  }

  /// Every read goes through here: a missing tenant match is indistinguishable
  /// from a missing row, so a wrong tenant can never confirm existence.
  async get(tenantId: string, id: string) {
    const found = await this.prisma.opportunity.findFirst({
      where: { id, tenantId },
      include: {
        artifacts: { orderBy: { createdAt: 'asc' } },
        analyses: {
          orderBy: { startedAt: 'desc' },
          select: {
            id: true,
            startedAt: true,
            finishedAt: true,
            failed: true,
            failure: true,
            rulePackVersion: true,
            analysisEngineVersion: true,
            targetStrategy: true,
          },
        },
      },
    });
    if (!found) throw new NotFoundException('opportunity not found');
    return found;
  }

  async create(user: Principal, dto: CreateOpportunityDto) {
    const created = await this.prisma.opportunity.create({
      data: { ...dto, tenantId: user.tenantId, createdBy: user.userId },
    });
    await this.audit.record(user.tenantId, user.userId, 'opportunity.created', 'Opportunity', created.id, {
      name: created.name,
    });
    return created;
  }

  async setReviewState(user: Principal, id: string, dto: ReviewStateDto) {
    await this.get(user.tenantId, id);
    const updated = await this.prisma.opportunity.update({ where: { id }, data: { ...dto } });
    await this.audit.record(user.tenantId, user.userId, 'opportunity.review_state_changed', 'Opportunity', id, {
      ...dto,
    });
    return updated;
  }
}

@Controller('opportunities')
@UseGuards(AuthGuard)
export class OpportunitiesController {
  constructor(private readonly svc: OpportunitiesService) {}

  @Get()
  list(@CurrentUser() user: Principal) {
    return this.svc.list(user.tenantId);
  }

  @Get(':id')
  get(@CurrentUser() user: Principal, @Param('id') id: string) {
    return this.svc.get(user.tenantId, id);
  }

  @Post()
  @Roles(Role.ORG_ADMIN, Role.CONTROLS_ENGINEER, Role.PROJECT_MANAGER, Role.ESTIMATOR)
  create(@CurrentUser() user: Principal, @Body() dto: CreateOpportunityDto) {
    return this.svc.create(user, dto);
  }

  /// Engineering review completion is a Controls Engineer's call; shutdown
  /// feasibility is a project judgement. A Viewer or Estimator cannot flip them.
  @Patch(':id/review-state')
  @Roles(Role.ORG_ADMIN, Role.CONTROLS_ENGINEER, Role.PROJECT_MANAGER)
  setReviewState(
    @CurrentUser() user: Principal,
    @Param('id') id: string,
    @Body() dto: ReviewStateDto,
  ) {
    return this.svc.setReviewState(user, id, dto);
  }
}

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [OpportunitiesController],
  providers: [OpportunitiesService, PrismaService],
  exports: [OpportunitiesService],
})
export class OpportunitiesModule {}
