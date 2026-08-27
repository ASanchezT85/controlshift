import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Role, ValidationState } from '@prisma/client';
import { IsArray, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { AuditModule, AuditService } from './audit';
import { AuthGuard, AuthModule, CurrentUser, Principal, Roles } from './auth';
import { PrismaService } from './prisma.service';

/**
 * Assumptions and exclusions (MASTER SPEC 29/30/37).
 *
 * Two separate acts by two separate roles. Validating an assumption is an
 * engineering judgement; approving an exclusion is a commercial one. Neither is
 * ever performed by the analysis engine, and an exclusion is not an exclusion
 * until a person approves it - until then reports call it a proposal.
 */

class AssumptionDto {
  @IsString() @MinLength(4) statement: string;
  @IsString() @MinLength(4) basis: string;
  @IsString() @MinLength(4) consequenceIfFalse: string;
  @IsOptional() @IsArray() @IsString({ each: true }) affectedScope?: string[];
  @IsOptional() @IsString() sourceUnknownId?: string;
}

class ValidateAssumptionDto {
  @IsEnum(ValidationState) validationState: ValidationState;
}

class ExclusionDto {
  @IsString() @MinLength(2) scopeArea: string;
  @IsString() @MinLength(4) reason: string;
  @IsOptional() @IsArray() @IsString({ each: true }) relatedUnknowns?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) relatedFindings?: string[];
}

@Injectable()
export class CommercialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async opportunity(tenantId: string, id: string) {
    const found = await this.prisma.opportunity.findFirst({ where: { id, tenantId } });
    if (!found) throw new NotFoundException('opportunity not found');
    return found;
  }

  async list(tenantId: string, opportunityId: string) {
    await this.opportunity(tenantId, opportunityId);
    const [assumptions, exclusions] = await Promise.all([
      this.prisma.assumption.findMany({ where: { opportunityId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.exclusion.findMany({ where: { opportunityId }, orderBy: { createdAt: 'asc' } }),
    ]);
    return { assumptions, exclusions };
  }

  async createAssumption(user: Principal, opportunityId: string, dto: AssumptionDto) {
    await this.opportunity(user.tenantId, opportunityId);
    const created = await this.prisma.assumption.create({
      data: {
        opportunityId,
        statement: dto.statement,
        basis: dto.basis,
        consequenceIfFalse: dto.consequenceIfFalse,
        affectedScope: dto.affectedScope ?? [],
        sourceUnknownId: dto.sourceUnknownId,
        createdBy: user.userId,
      },
    });
    await this.audit.record(user.tenantId, user.userId, 'assumption.created', 'Assumption', created.id, {
      opportunityId,
      statement: created.statement,
    });
    return created;
  }

  /// Engineering judgement. An assumption that turns out false does not vanish:
  /// it becomes INVALIDATED and stays visible, because the scope built on it is
  /// the thing that has to be revisited.
  async validateAssumption(user: Principal, id: string, dto: ValidateAssumptionDto) {
    const assumption = await this.prisma.assumption.findFirst({
      where: { id, opportunity: { tenantId: user.tenantId } },
    });
    if (!assumption) throw new NotFoundException('assumption not found');

    const updated = await this.prisma.assumption.update({
      where: { id },
      data: {
        validationState: dto.validationState,
        reviewedBy: user.userId,
        reviewedAt: new Date(),
      },
    });
    await this.audit.record(
      user.tenantId,
      user.userId,
      `assumption.${dto.validationState.toLowerCase()}`,
      'Assumption',
      id,
      { opportunityId: assumption.opportunityId, statement: assumption.statement },
    );
    return updated;
  }

  async deleteAssumption(user: Principal, id: string) {
    const assumption = await this.prisma.assumption.findFirst({
      where: { id, opportunity: { tenantId: user.tenantId } },
    });
    if (!assumption) throw new NotFoundException('assumption not found');
    if (assumption.validationState !== 'ASSUMED') {
      throw new BadRequestException(
        'a reviewed assumption is part of the record and cannot be deleted; ' +
          'mark it INVALIDATED instead',
      );
    }
    await this.prisma.assumption.delete({ where: { id } });
    await this.audit.record(user.tenantId, user.userId, 'assumption.deleted', 'Assumption', id, {
      opportunityId: assumption.opportunityId,
      statement: assumption.statement,
    });
    return { deleted: true };
  }

  async createExclusion(user: Principal, opportunityId: string, dto: ExclusionDto) {
    await this.opportunity(user.tenantId, opportunityId);
    const created = await this.prisma.exclusion.create({
      data: {
        opportunityId,
        scopeArea: dto.scopeArea,
        reason: dto.reason,
        relatedUnknowns: dto.relatedUnknowns ?? [],
        relatedFindings: dto.relatedFindings ?? [],
        createdBy: user.userId,
      },
    });
    await this.audit.record(user.tenantId, user.userId, 'exclusion.proposed', 'Exclusion', created.id, {
      opportunityId,
      scopeArea: created.scopeArea,
    });
    return created;
  }

  /// Commercial act, separate from engineering review (SPEC 37).
  async approveExclusion(user: Principal, id: string) {
    const exclusion = await this.prisma.exclusion.findFirst({
      where: { id, opportunity: { tenantId: user.tenantId } },
    });
    if (!exclusion) throw new NotFoundException('exclusion not found');
    if (exclusion.approvedBy) return exclusion;

    const updated = await this.prisma.exclusion.update({
      where: { id },
      data: { approvedBy: user.userId, approvedAt: new Date() },
    });
    await this.audit.record(user.tenantId, user.userId, 'exclusion.approved', 'Exclusion', id, {
      opportunityId: exclusion.opportunityId,
      scopeArea: exclusion.scopeArea,
    });
    return updated;
  }

  async deleteExclusion(user: Principal, id: string) {
    const exclusion = await this.prisma.exclusion.findFirst({
      where: { id, opportunity: { tenantId: user.tenantId } },
    });
    if (!exclusion) throw new NotFoundException('exclusion not found');
    if (exclusion.approvedBy) {
      throw new BadRequestException(
        'an approved exclusion has already shaped a commercial output and cannot be deleted',
      );
    }
    await this.prisma.exclusion.delete({ where: { id } });
    await this.audit.record(user.tenantId, user.userId, 'exclusion.withdrawn', 'Exclusion', id, {
      opportunityId: exclusion.opportunityId,
      scopeArea: exclusion.scopeArea,
    });
    return { deleted: true };
  }

  /// Turns the latest analysis into DRAFT propositions for a human to edit,
  /// approve or throw away. It proposes; it never approves, and it never
  /// invents a proposition that no unknown or finding supports.
  async proposeFromAnalysis(user: Principal, opportunityId: string) {
    await this.opportunity(user.tenantId, opportunityId);
    const analysis = await this.prisma.analysis.findFirst({
      where: { opportunityId, failed: false },
      orderBy: { startedAt: 'desc' },
    });
    if (!analysis?.result) throw new NotFoundException('this opportunity has no completed analysis');
    const result = analysis.result as any;

    const existing = await this.list(user.tenantId, opportunityId);
    const haveAssumption = new Set(existing.assumptions.map((a) => a.sourceUnknownId ?? a.statement));
    const haveExclusion = new Set(existing.exclusions.map((e) => e.scopeArea));

    const assumptions: any[] = [];
    const exclusions: any[] = [];

    // The two propositions every reconstruction rests on, stated rather than
    // left implicit.
    for (const baseline of [
      {
        statement: 'The supplied PLC source is the program currently running on the line.',
        basis: 'No upload from the controller was performed; ControlShift analyzes copies only.',
        consequenceIfFalse:
          'The reconstructed system model and every count derived from it are wrong.',
        affectedScope: ['PLC_LOGIC', 'IO'],
      },
      {
        statement:
          'Field wiring matches the supplied I/O list where as-built drawings are absent.',
        basis: 'Supplied electrical drawings are not as-built.',
        consequenceIfFalse: 'Panel retrofit and I/O checkout scope grow by an unquantified amount.',
        affectedScope: ['ELECTRICAL', 'IO'],
      },
    ]) {
      if (!haveAssumption.has(baseline.statement)) {
        assumptions.push(
          await this.createAssumption(user, opportunityId, baseline as AssumptionDto),
        );
      }
    }

    for (const u of result.unknowns ?? []) {
      if (u.estimate_allowance_profile === 'EXCLUDE_OR_ALLOWANCE') {
        const scopeArea = (u.affected_domains ?? []).join(', ') || 'UNSPECIFIED';
        if (!haveExclusion.has(scopeArea)) {
          haveExclusion.add(scopeArea);
          exclusions.push(
            await this.createExclusion(user, opportunityId, {
              scopeArea,
              reason: `${u.missing_information} is not evidenced. ${u.commercial_impact}`,
              relatedUnknowns: [u.id],
              relatedFindings: [],
            }),
          );
        }
      } else if (u.estimate_allowance_profile === 'ALLOWANCE' && !haveAssumption.has(u.id)) {
        assumptions.push(
          await this.createAssumption(user, opportunityId, {
            statement: `An allowance covers the work implied by: ${u.missing_information}.`,
            basis: `Proposed from unknown ${u.id} of analysis ${analysis.id}.`,
            consequenceIfFalse: u.commercial_impact,
            affectedScope: u.affected_domains ?? [],
            sourceUnknownId: u.id,
          }),
        );
      }
    }

    // A RESOLVE_BEFORE_QUOTE unknown gets neither: it cannot be assumed away
    // and it cannot be excluded into safety. It has to be answered.
    return { assumptions, exclusions };
  }
}

@Controller()
@UseGuards(AuthGuard)
export class CommercialController {
  constructor(private readonly svc: CommercialService) {}

  @Get('opportunities/:id/commercial')
  list(@CurrentUser() user: Principal, @Param('id') id: string) {
    return this.svc.list(user.tenantId, id);
  }

  @Post('opportunities/:id/commercial/propose')
  @Roles(Role.ORG_ADMIN, Role.CONTROLS_ENGINEER, Role.ESTIMATOR, Role.PROJECT_MANAGER)
  propose(@CurrentUser() user: Principal, @Param('id') id: string) {
    return this.svc.proposeFromAnalysis(user, id);
  }

  @Post('opportunities/:id/assumptions')
  @Roles(Role.ORG_ADMIN, Role.CONTROLS_ENGINEER, Role.ESTIMATOR, Role.PROJECT_MANAGER)
  createAssumption(
    @CurrentUser() user: Principal,
    @Param('id') id: string,
    @Body() dto: AssumptionDto,
  ) {
    return this.svc.createAssumption(user, id, dto);
  }

  /// Validating an assumption is a technical call, not a commercial one.
  @Patch('assumptions/:assumptionId')
  @Roles(Role.ORG_ADMIN, Role.CONTROLS_ENGINEER)
  validateAssumption(
    @CurrentUser() user: Principal,
    @Param('assumptionId') assumptionId: string,
    @Body() dto: ValidateAssumptionDto,
  ) {
    return this.svc.validateAssumption(user, assumptionId, dto);
  }

  @Delete('assumptions/:assumptionId')
  @Roles(Role.ORG_ADMIN, Role.CONTROLS_ENGINEER, Role.ESTIMATOR, Role.PROJECT_MANAGER)
  deleteAssumption(
    @CurrentUser() user: Principal,
    @Param('assumptionId') assumptionId: string,
  ) {
    return this.svc.deleteAssumption(user, assumptionId);
  }

  @Post('opportunities/:id/exclusions')
  @Roles(Role.ORG_ADMIN, Role.CONTROLS_ENGINEER, Role.ESTIMATOR, Role.PROJECT_MANAGER)
  createExclusion(
    @CurrentUser() user: Principal,
    @Param('id') id: string,
    @Body() dto: ExclusionDto,
  ) {
    return this.svc.createExclusion(user, id, dto);
  }

  /// Approving an exclusion is a commercial call, not a technical one.
  @Patch('exclusions/:exclusionId/approve')
  @Roles(Role.ORG_ADMIN, Role.ESTIMATOR, Role.PROJECT_MANAGER)
  approveExclusion(
    @CurrentUser() user: Principal,
    @Param('exclusionId') exclusionId: string,
  ) {
    return this.svc.approveExclusion(user, exclusionId);
  }

  @Delete('exclusions/:exclusionId')
  @Roles(Role.ORG_ADMIN, Role.CONTROLS_ENGINEER, Role.ESTIMATOR, Role.PROJECT_MANAGER)
  deleteExclusion(
    @CurrentUser() user: Principal,
    @Param('exclusionId') exclusionId: string,
  ) {
    return this.svc.deleteExclusion(user, exclusionId);
  }
}

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [CommercialController],
  providers: [CommercialService, PrismaService],
  exports: [CommercialService],
})
export class CommercialModule {}
