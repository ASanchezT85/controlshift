import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsArray, IsNumber, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AuditModule, AuditService } from './audit';
import { AuthGuard, AuthModule, CurrentUser, Principal, Roles } from './auth';
import { PrismaService } from './prisma.service';

/**
 * Estimating engine (MASTER SPEC 32/33).
 *
 * Deterministic arithmetic over the organization's own templates. There is no
 * model in this file and no default hour value that ControlShift claims as
 * universal: a work package with no template is reported as NOT PRICED and is
 * excluded from the range. Inventing hours would be worse than a gap.
 */

export const ESTIMATE_SCHEMA_VERSION = '1.0.0';

/// Shipped as a starting point for a new organization, not as truth. Every
/// number here is expected to be overwritten by the integrator.
export const STARTER_TEMPLATES: Array<{
  workPackageCode: string;
  unitType: string;
  role: string;
  minHoursPerUnit: number;
  maxHoursPerUnit: number;
}> = [
  // Keyed by (work package, unit). The same package legitimately arrives in
  // different units - reviewing a PID loop is not reviewing an S: reference -
  // and each pair needs its own rate or the work silently goes unpriced.
  { workPackageCode: 'PLC_PROGRAM_REVIEW', unitType: 'REFERENCE', role: 'CONTROLS_ENGINEER', minHoursPerUnit: 0.1, maxHoursPerUnit: 0.35 },
  { workPackageCode: 'PLC_PROGRAM_REVIEW', unitType: 'INSTRUCTION', role: 'CONTROLS_ENGINEER', minHoursPerUnit: 0.5, maxHoursPerUnit: 1.5 },
  { workPackageCode: 'PLC_PROGRAM_REVIEW', unitType: 'LOOP', role: 'CONTROLS_ENGINEER', minHoursPerUnit: 1, maxHoursPerUnit: 3 },
  { workPackageCode: 'PLC_PROGRAM_REVIEW', unitType: 'MODULE', role: 'CONTROLS_ENGINEER', minHoursPerUnit: 0.5, maxHoursPerUnit: 2 },
  { workPackageCode: 'PLC_PROGRAM_REVIEW', unitType: 'ITEM', role: 'CONTROLS_ENGINEER', minHoursPerUnit: 0.5, maxHoursPerUnit: 2 },
  { workPackageCode: 'PLC_PROGRAM_REVIEW', unitType: 'PROJECT', role: 'CONTROLS_ENGINEER', minHoursPerUnit: 4, maxHoursPerUnit: 12 },

  { workPackageCode: 'UNSUPPORTED_INSTRUCTION_REWRITE', unitType: 'INSTRUCTION', role: 'CONTROLS_ENGINEER', minHoursPerUnit: 2, maxHoursPerUnit: 6 },
  { workPackageCode: 'UNSUPPORTED_INSTRUCTION_REWRITE', unitType: 'REFERENCE', role: 'CONTROLS_ENGINEER', minHoursPerUnit: 0.5, maxHoursPerUnit: 2 },

  { workPackageCode: 'PID_VALIDATION', unitType: 'LOOP', role: 'CONTROLS_ENGINEER', minHoursPerUnit: 3, maxHoursPerUnit: 8 },
  { workPackageCode: 'MSG_RECONFIGURATION', unitType: 'MESSAGE', role: 'CONTROLS_ENGINEER', minHoursPerUnit: 0.5, maxHoursPerUnit: 1.5 },
  { workPackageCode: 'PLC_COMMUNICATION_REVIEW', unitType: 'MESSAGE', role: 'CONTROLS_ENGINEER', minHoursPerUnit: 0.5, maxHoursPerUnit: 1.5 },
  { workPackageCode: 'PLC_COMMUNICATION_REVIEW', unitType: 'NETWORK', role: 'CONTROLS_ENGINEER', minHoursPerUnit: 4, maxHoursPerUnit: 12 },

  { workPackageCode: 'IO_MIGRATION_DESIGN', unitType: 'MODULE', role: 'CONTROLS_ENGINEER', minHoursPerUnit: 1.5, maxHoursPerUnit: 4 },
  { workPackageCode: 'PANEL_RETROFIT', unitType: 'MODULE', role: 'PANEL_SHOP', minHoursPerUnit: 2, maxHoursPerUnit: 6 },
  { workPackageCode: 'PANEL_RETROFIT', unitType: 'ITEM', role: 'PANEL_SHOP', minHoursPerUnit: 1, maxHoursPerUnit: 4 },

  { workPackageCode: 'DEVICENET_MIGRATION', unitType: 'NETWORK', role: 'CONTROLS_ENGINEER', minHoursPerUnit: 16, maxHoursPerUnit: 48 },
  { workPackageCode: 'DEVICENET_MIGRATION', unitType: 'ITEM', role: 'CONTROLS_ENGINEER', minHoursPerUnit: 4, maxHoursPerUnit: 12 },
  { workPackageCode: 'NET_DEVICE_MIGRATION', unitType: 'NETWORK', role: 'CONTROLS_ENGINEER', minHoursPerUnit: 8, maxHoursPerUnit: 24 },
  { workPackageCode: 'NET_DEVICE_MIGRATION', unitType: 'DEVICE', role: 'CONTROLS_ENGINEER', minHoursPerUnit: 2, maxHoursPerUnit: 6 },

  { workPackageCode: 'CONTROLS_DESIGN', unitType: 'PROJECT', role: 'CONTROLS_ENGINEER', minHoursPerUnit: 16, maxHoursPerUnit: 40 },
  { workPackageCode: 'IO_CHECKOUT', unitType: 'MODULE', role: 'COMMISSIONING_ENGINEER', minHoursPerUnit: 1, maxHoursPerUnit: 3 },

  { workPackageCode: 'FAT', unitType: 'ITEM', role: 'CONTROLS_ENGINEER', minHoursPerUnit: 1, maxHoursPerUnit: 3 },
  { workPackageCode: 'FAT', unitType: 'INSTRUCTION', role: 'CONTROLS_ENGINEER', minHoursPerUnit: 1, maxHoursPerUnit: 3 },
  { workPackageCode: 'FAT', unitType: 'LOOP', role: 'CONTROLS_ENGINEER', minHoursPerUnit: 2, maxHoursPerUnit: 6 },
  { workPackageCode: 'COMMUNICATION_FAT', unitType: 'MESSAGE', role: 'CONTROLS_ENGINEER', minHoursPerUnit: 0.5, maxHoursPerUnit: 2 },
  { workPackageCode: 'COMMUNICATION_FAT', unitType: 'NETWORK', role: 'CONTROLS_ENGINEER', minHoursPerUnit: 4, maxHoursPerUnit: 12 },
  { workPackageCode: 'DOCUMENTATION_UPDATE', unitType: 'ITEM', role: 'CONTROLS_ENGINEER', minHoursPerUnit: 1, maxHoursPerUnit: 4 },
];

// DISCOVERY is deliberately absent: it is the work package that unevidenced
// scope generates, and its size is exactly what is unknown. It surfaces as
// NOT PRICED until the organization decides its own discovery template.

export interface EstimateLine {
  workPackageCode: string;
  unitType: string;
  role: string;
  quantity: number;
  minHours: number;
  maxHours: number;
  complexityFactor: number;
  triggeredBy: string[];
}

export interface UnpricedLine {
  workPackageCode: string;
  unitType: string;
  quantity: number;
  reason: string;
  triggeredBy: string[];
}

export interface Estimate {
  schemaVersion: string;
  analysisId: string;
  rulePackVersion: string;
  lines: EstimateLine[];
  unpriced: UnpricedLine[];
  allowances: Array<{ unknownId: string; missingInformation: string; profile: string; note: string }>;
  totals: {
    minHours: number;
    maxHours: number;
    uncertaintyAllowancePercent: number;
    minHoursWithAllowance: number;
    maxHoursWithAllowance: number;
  };
  caveats: string[];
}

const round = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class EstimatingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  templates(tenantId: string) {
    return this.prisma.effortTemplate.findMany({
      where: { tenantId },
      orderBy: { workPackageCode: 'asc' },
    });
  }

  async upsertTemplates(user: Principal, rows: TemplateDto[]) {
    for (const row of rows) {
      await this.prisma.effortTemplate.upsert({
        where: {
          tenantId_workPackageCode_unitType: {
            tenantId: user.tenantId,
            workPackageCode: row.workPackageCode,
            unitType: row.unitType,
          },
        },
        create: { ...row, tenantId: user.tenantId },
        update: { ...row },
      });
    }
    await this.audit.record(user.tenantId, user.userId, 'estimate.templates_modified', 'Tenant', user.tenantId, {
      workPackages: rows.map((r) => r.workPackageCode),
    });
    return this.templates(user.tenantId);
  }

  /// Pure arithmetic over the stored analysis. Same analysis plus same
  /// templates always yields the same range.
  async estimate(tenantId: string, opportunityId: string): Promise<Estimate> {
    const opportunity = await this.prisma.opportunity.findFirst({
      where: { id: opportunityId, tenantId },
    });
    if (!opportunity) throw new NotFoundException('opportunity not found');

    const analysis = await this.prisma.analysis.findFirst({
      where: { opportunityId, failed: false },
      orderBy: { startedAt: 'desc' },
    });
    if (!analysis?.result) throw new NotFoundException('this opportunity has no completed analysis');

    const tenant = await this.prisma.tenant.findFirstOrThrow({ where: { id: tenantId } });
    const templates = await this.templates(tenantId);
    // Keyed by code AND unit: a template prices one unit of work, and the
    // engine reports a separate line per unit type.
    const byKey = new Map(templates.map((t) => [`${t.workPackageCode}|${t.unitType}`, t]));
    const result = analysis.result as any;

    const lines: EstimateLine[] = [];
    const unpriced: UnpricedLine[] = [];

    for (const wp of result.work_packages ?? []) {
      const template = byKey.get(`${wp.code}|${wp.unit_type}`);
      if (!template) {
        unpriced.push({
          workPackageCode: wp.code,
          unitType: wp.unit_type,
          quantity: wp.quantity,
          reason: `no effort template configured for ${wp.code} in ${wp.unit_type} units`,
          triggeredBy: wp.triggered_by ?? [],
        });
        continue;
      }
      lines.push({
        workPackageCode: wp.code,
        unitType: template.unitType,
        role: template.role,
        quantity: wp.quantity,
        complexityFactor: template.complexityFactor,
        minHours: round(wp.quantity * template.minHoursPerUnit * template.complexityFactor),
        maxHours: round(wp.quantity * template.maxHoursPerUnit * template.complexityFactor),
        triggeredBy: wp.triggered_by ?? [],
      });
    }

    // Unknowns never become hours. They become a disclosed allowance decision
    // for a human (SPEC 31).
    const allowances = (result.unknowns ?? []).map((u: any) => ({
      unknownId: u.id,
      missingInformation: u.missing_information,
      profile: u.estimate_allowance_profile,
      note:
        u.estimate_allowance_profile === 'RESOLVE_BEFORE_QUOTE'
          ? 'Must be resolved before a fixed price. No allowance can substitute for it.'
          : 'Exclude from scope or carry a commercial allowance. Not estimated here.',
    }));

    const minHours = round(lines.reduce((n, l) => n + l.minHours, 0));
    const maxHours = round(lines.reduce((n, l) => n + l.maxHours, 0));
    const pct = tenant.uncertaintyAllowancePercent;

    const caveats: string[] = [
      'Hours are computed from this organization\'s effort templates. ControlShift claims no universal engineering-hour values.',
    ];
    if (unpriced.length) {
      caveats.push(
        `${unpriced.length} work package(s) are NOT PRICED and are excluded from the range: ` +
          `${unpriced.map((u) => u.workPackageCode).join(', ')}.`,
      );
    }
    const critical = allowances.filter((a: any) => a.profile === 'RESOLVE_BEFORE_QUOTE');
    if (critical.length) {
      caveats.push(
        `${critical.length} unknown(s) must be resolved before a fixed price; this range does not cover them.`,
      );
    }
    if (result.quote_readiness?.fixed_price !== 'READY') {
      caveats.push('Fixed-price readiness is NOT READY. This range is budgetary at best.');
    }

    return {
      schemaVersion: ESTIMATE_SCHEMA_VERSION,
      analysisId: analysis.id,
      rulePackVersion: analysis.rulePackVersion,
      lines,
      unpriced,
      allowances,
      totals: {
        minHours,
        maxHours,
        uncertaintyAllowancePercent: pct,
        minHoursWithAllowance: round(minHours * (1 + pct / 100)),
        maxHoursWithAllowance: round(maxHours * (1 + pct / 100)),
      },
      caveats,
    };
  }
}

class TemplateDto {
  @IsString() workPackageCode: string;
  @IsString() unitType: string;
  @IsString() role: string;
  @IsNumber() @Min(0) minHoursPerUnit: number;
  @IsNumber() @Min(0) maxHoursPerUnit: number;
  @IsNumber() @Min(0) complexityFactor: number;
}

class TemplatesDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => TemplateDto) templates: TemplateDto[];
}

@Controller()
@UseGuards(AuthGuard)
export class EstimatingController {
  constructor(private readonly svc: EstimatingService) {}

  @Get('effort-templates')
  templates(@CurrentUser() user: Principal) {
    return this.svc.templates(user.tenantId);
  }

  @Put('effort-templates')
  @Roles(Role.ORG_ADMIN, Role.ESTIMATOR)
  upsert(@CurrentUser() user: Principal, @Body() dto: TemplatesDto) {
    return this.svc.upsertTemplates(user, dto.templates);
  }

  @Get('opportunities/:id/estimate')
  estimate(@CurrentUser() user: Principal, @Param('id') id: string) {
    return this.svc.estimate(user.tenantId, id);
  }
}

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [EstimatingController],
  providers: [EstimatingService, PrismaService],
  exports: [EstimatingService],
})
export class EstimatingModule {}
