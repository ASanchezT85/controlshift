import {
  Body,
  Controller,
  Get,
  Header,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ReportKind, Role } from '@prisma/client';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { IsIn } from 'class-validator';
import { AuditModule, AuditService } from './audit';
import { AuthGuard, AuthModule, CurrentUser, Principal, Roles } from './auth';
import { CommercialModule, CommercialService } from './commercial';
import { EstimatingModule, EstimatingService, type Estimate } from './estimating';
import { PrismaService } from './prisma.service';
import { storageRoot } from './artifacts';

/**
 * The three V1 deliverables (MASTER SPEC 38), rendered from the stored
 * AnalysisResult and the organization's estimate. Nothing here computes a
 * finding, a coverage number or an hour: a report is a view of what was
 * already decided deterministically upstream.
 */

export const REPORT_SCHEMA_VERSION = '1.0.0';

const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/// MASTER SPEC 28 order. An empty section is printed as empty: leaving it out
/// would read as an oversight rather than as a decision.
const SCOPE_SECTIONS = [
  'Discovery',
  'Controls Design',
  'PLC Software',
  'Networks',
  'HMI',
  'Drives',
  'Panel',
  'Testing',
  'Site',
  'Documentation',
  'Project Management',
];

const TITLES: Record<ReportKind, string> = {
  ENGINEERING_PREFLIGHT: 'Engineering Preflight',
  PROPOSAL_INPUT_PACKAGE: 'Proposal Input Package',
  CUSTOMER_INFORMATION_REQUEST: 'Customer Information Request',
};

interface Ctx {
  kind: ReportKind;
  tenant: {
    name: string;
    brandName: string | null;
    brandLogo: string | null;
    reportFooter: string | null;
    preparedByLine: string | null;
  };
  opportunity: {
    name: string;
    customerName: string;
    facilityName: string;
    proposalType: string;
    shutdownRequirementHours: number | null;
    requestedTarget: string;
    engineeringReviewComplete: boolean;
    customerLogo: string | null;
  };
  analysis: { id: string; rulePackVersion: string; analysisEngineVersion: string; startedAt: Date };
  result: any;
  estimate: Estimate | null;
  assumptions: Array<{
    statement: string;
    basis: string;
    consequenceIfFalse: string;
    validationState: string;
    affectedScope: string[];
  }>;
  exclusions: Array<{
    scopeArea: string;
    reason: string;
    relatedUnknowns: string[];
    approvedBy: string | null;
    approvedAt: Date | null;
  }>;
  generatedByName: string;
  generatedAt: string;
}

function shell(ctx: Ctx, body: string): string {
  const brand = ctx.tenant.brandName ?? ctx.tenant.name;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(TITLES[ctx.kind])} — ${esc(ctx.opportunity.name)}</title>
<style>
  :root { --ink:#16191d; --muted:#5c6570; --line:#d8dde3; --blocked:#a8202b; --warn:#8a5a00; }
  * { box-sizing:border-box }
  body { font:14px/1.55 ui-sans-serif,-apple-system,'Segoe UI',Roboto,sans-serif; color:var(--ink);
         margin:0; padding:40px; max-width:960px }
  header.cover { border-bottom:2px solid var(--ink); padding-bottom:18px; margin-bottom:28px;
                 display:flex; gap:20px; align-items:flex-start }
  header.cover img { max-height:56px; max-width:200px }
  header.cover img.customer { margin-left:auto }
  h1 { font-size:22px; margin:0 0 6px }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.07em; color:var(--muted);
       border-bottom:1px solid var(--line); padding-bottom:6px; margin:32px 0 12px }
  table { width:100%; border-collapse:collapse; font-size:13px; margin-bottom:8px }
  th,td { text-align:left; padding:7px 9px; border-bottom:1px solid var(--line); vertical-align:top }
  th { font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted) }
  .state { font-weight:600; white-space:nowrap; font-size:12px }
  .BLOCKED,.NOT_READY { color:var(--blocked) }
  .UNKNOWN,.REVIEW_REQUIRED,.READY_WITH_ALLOWANCES { color:var(--warn) }
  .muted { color:var(--muted) }
  .stamp { border:1px solid var(--blocked); color:var(--blocked); font-weight:700; padding:8px 12px;
           display:inline-block; letter-spacing:.05em; font-size:12px; margin:6px 0 14px }
  .trace { font-family:ui-monospace,Consolas,monospace; font-size:11.5px; color:var(--muted) }
  footer { margin-top:44px; border-top:1px solid var(--line); padding-top:12px;
           font-size:11.5px; color:var(--muted) }
  @media print { body { padding:0 } h2 { break-after:avoid } tr { break-inside:avoid } }
</style></head><body>
<header class="cover">
  ${ctx.tenant.brandLogo ? `<img src="${esc(ctx.tenant.brandLogo)}" alt="${esc(brand)}">` : ''}
  <div>
    <h1>${esc(TITLES[ctx.kind])}</h1>
    <div>${esc(ctx.opportunity.name)} — ${esc(ctx.opportunity.customerName)}, ${esc(ctx.opportunity.facilityName)}</div>
    <div class="muted">Prepared by ${esc(brand)} · ${esc(ctx.generatedByName)} · ${esc(ctx.generatedAt)}</div>
    ${ctx.tenant.preparedByLine ? `<div class="muted">${esc(ctx.tenant.preparedByLine)}</div>` : ''}
  </div>
  ${ctx.opportunity.customerLogo
      ? `<img class="customer" src="${esc(ctx.opportunity.customerLogo)}" alt="${esc(ctx.opportunity.customerName)}">`
      : ''}
</header>
${body}
<footer>
  ${ctx.tenant.reportFooter ? `<div>${esc(ctx.tenant.reportFooter)}</div>` : ''}
  <div>Rule pack ${esc(ctx.analysis.rulePackVersion)} · engine ${esc(ctx.analysis.analysisEngineVersion)}
       · parser ${esc(ctx.result.versions.parser_version)} · IR ${esc(ctx.result.versions.ir_schema_version)}
       · report schema ${REPORT_SCHEMA_VERSION} · analysis ${esc(ctx.analysis.id)}</div>
  <div>This assessment is reproducible from the recorded versions above. It is a preflight
       assessment, not a commissioning or safety validation.</div>
</footer>
</body></html>`;
}

function readinessBlock(r: any): string {
  const q = r.quote_readiness;
  return `<h2>Quote readiness</h2>
<table><tbody>
  <tr><td>Fixed price</td><td class="state ${esc(q.fixed_price)}">${esc(q.fixed_price.replace(/_/g, ' '))}</td></tr>
  <tr><td>Budgetary</td><td class="state ${esc(q.budgetary)}">${esc(q.budgetary.replace(/_/g, ' '))}</td></tr>
  <tr><td>Time and material</td><td class="state ${esc(q.time_and_material)}">${esc(q.time_and_material.replace(/_/g, ' '))}</td></tr>
</tbody></table>
${q.reasons.length ? `<ul class="muted">${q.reasons.map((x: string) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`;
}

function engineeringPreflight(ctx: Ctx): string {
  const r = ctx.result;
  const s = r.system_model;
  const rungs = s.programs.reduce((n: number, p: any) => n + p.rungs.length, 0);
  return shell(
    ctx,
    `<h2>Source system as reconstructed</h2>
<table><tbody>
 <tr><td>Processor</td><td>${esc(s.processor)} (${esc(s.processor_os)}, series ${esc(s.processor_series)})</td></tr>
 <tr><td>Chassis</td><td>${esc(s.chassis)}, ${s.modules.length} slots</td></tr>
 <tr><td>Program</td><td>${s.programs.length} program files, ${rungs} rungs, ${s.programs.reduce(
      (n: number, p: any) => n + p.rungs.reduce((m: number, g: any) => m + g.instructions.length, 0),
      0,
    )} instructions</td></tr>
 <tr><td>Timed interrupt</td><td>${s.sti ? `STI in LAD${s.sti.program_file} at ${s.sti.interval_ms} ms` : 'none declared'}</td></tr>
</tbody></table>
<table><thead><tr><th>Slot</th><th>Catalog</th></tr></thead><tbody>
${s.modules.map((m: any) => `<tr><td>${m.slot}</td><td>${esc(m.catalog)}</td></tr>`).join('')}
</tbody></table>

<h2>Evidence coverage</h2>
<table><thead><tr><th>Domain</th><th>Coverage</th><th>Missing evidence</th></tr></thead><tbody>
${r.evidence_coverage
      .map(
        (d: any) =>
          `<tr><td>${esc(d.domain.replace(/_/g, ' '))}</td><td>${d.percent}%</td><td class="muted">${esc(
            d.missing.join(', ') || '—',
          )}</td></tr>`,
      )
      .join('')}
</tbody></table>

<h2>Findings (${r.findings.length})</h2>
<table><thead><tr><th>ID</th><th>State</th><th>Category</th><th>Finding</th><th>Qty</th><th>Evidence</th></tr></thead><tbody>
${r.findings
      .map(
        (f: any) =>
          `<tr><td>${esc(f.id)}</td><td class="state ${esc(f.state)}">${esc(f.state.replace(/_/g, ' '))}</td>
            <td class="muted">${esc(f.category.replace(/_/g, ' '))}</td>
            <td><strong>${esc(f.title)}</strong><div class="muted">${esc(f.description)}</div></td>
            <td>${f.quantity ?? '—'}</td>
            <td class="muted">${esc(f.evidence.map((e: any) => e.publication_id ?? e.locator ?? e.source_type).join('; '))}</td></tr>`,
      )
      .join('')}
</tbody></table>

<h2>Unresolved technical issues</h2>
<table><thead><tr><th>Missing information</th><th>Technical impact</th><th>Recommended resolution</th></tr></thead><tbody>
${r.unknowns
      .map(
        (u: any) =>
          `<tr><td>${esc(u.missing_information)}</td><td class="muted">${esc(u.technical_impact)}</td><td class="muted">${esc(
            u.recommended_resolution,
          )}</td></tr>`,
      )
      .join('')}
</tbody></table>

<h2>Dependencies</h2>
<p class="muted">${r.dependencies.length} reconstructed relationships. Network-level dependencies:</p>
<table><tbody>
${r.dependencies
      .filter((d: any) => d.to.startsWith('network:') || d.relation === 'NODE_INVENTORY')
      .map((d: any) => `<tr><td class="trace">${esc(d.from)} —${esc(d.relation)}→ ${esc(d.to)}</td></tr>`)
      .join('')}
</tbody></table>

<h2>Migration paths</h2>
<table><thead><tr><th>Path</th><th>Conclusion</th><th>Lifecycle risk</th><th>Blocked by</th><th>Notes</th></tr></thead><tbody>
${r.migration_paths
      .map(
        (p: any) =>
          `<tr><td>${esc(p.id)} — ${esc(p.name)}${p.preferred ? ' <strong>(preferred)</strong>' : ''}</td>
            <td>${esc(p.conclusion.replace(/_/g, ' '))}</td><td>${esc(p.lifecycle_risk)}</td>
            <td class="state BLOCKED">${esc(p.blocking_findings.join(', ') || '—')}</td>
            <td class="muted">${esc(p.notes.join(' '))}</td></tr>`,
      )
      .join('')}
</tbody></table>
${readinessBlock(r)}`,
  );
}

function proposalInputPackage(ctx: Ctx): string {
  const r = ctx.result;
  const e = ctx.estimate;
  const findingById = new Map(r.findings.map((f: any) => [f.id, f]));

  // SPEC 28: every scope item must answer "why is this in scope?" with a trace
  // back through work package, finding, rule and evidence.
  const trace = (ids: string[]) =>
    ids
      .map((id) => {
        const f: any = findingById.get(id);
        if (!f) return esc(id);
        const ev = f.evidence.map((x: any) => x.publication_id ?? x.locator ?? x.source_type).join('; ');
        return `${esc(id)} ← ${esc(f.rule_id)} ← ${esc(ev)}`;
      })
      .join('<br>');

  const approvedExclusions = ctx.exclusions.filter((e) => e.approvedBy);
  const proposedExclusions = ctx.exclusions.filter((e) => !e.approvedBy);
  const blockers = r.unknowns.filter((u: any) => u.estimate_allowance_profile === 'RESOLVE_BEFORE_QUOTE');

  return shell(
    ctx,
    `${readinessBlock(r)}

<h2>Shutdown constraint</h2>
<p>${ctx.opportunity.shutdownRequirementHours
      ? `Customer maximum: ${ctx.opportunity.shutdownRequirementHours} hours. Feasibility within that window is not established while DeviceNet, HMI, drive and safety scope remain unevidenced.`
      : 'No shutdown requirement supplied.'}</p>

<h2>Engineering scope</h2>
<table><thead><tr><th>Work package</th><th>Qty</th><th>Unit</th><th>Why it is in scope</th></tr></thead><tbody>
${SCOPE_SECTIONS.map((section) => {
      const items = (r.work_packages ?? []).filter((w: any) => w.section === section);
      return (
        `<tr><td colspan="4"><strong>${esc(section)}</strong>` +
        (items.length ? '' : ' <span class="muted">- nothing scoped here</span>') +
        `</td></tr>` +
        items
          .map(
            (w: any) =>
              `<tr><td style="padding-left:22px">${esc(w.code.replace(/_/g, ' '))}</td>
                <td>${w.quantity}</td><td class="muted">${esc(w.unit_type.toLowerCase())}</td>
                <td class="trace">${trace(w.triggered_by ?? [])}</td></tr>`,
          )
          .join('')
      );
    }).join('')}
</tbody></table>

<h2>Estimate range</h2>
${e
      ? `<table><thead><tr><th>Work package</th><th>Role</th><th>Qty</th><th>Unit</th><th>Min h</th><th>Max h</th></tr></thead><tbody>
${e.lines
          .map(
            (l) =>
              `<tr><td>${esc(l.workPackageCode.replace(/_/g, ' '))}</td><td class="muted">${esc(l.role)}</td>
                <td>${l.quantity}</td><td class="muted">${esc(l.unitType)}</td><td>${l.minHours}</td><td>${l.maxHours}</td></tr>`,
          )
          .join('')}
<tr><td colspan="4"><strong>Priced subtotal</strong></td><td><strong>${e.totals.minHours}</strong></td><td><strong>${e.totals.maxHours}</strong></td></tr>
<tr><td colspan="4">With ${e.totals.uncertaintyAllowancePercent}% uncertainty allowance</td><td>${e.totals.minHoursWithAllowance}</td><td>${e.totals.maxHoursWithAllowance}</td></tr>
</tbody></table>
${e.unpriced.length
          ? `<h2>Not priced</h2>
<table><thead><tr><th>Work package</th><th>Units</th><th>Reason</th></tr></thead><tbody>
${e.unpriced
              .map(
                (u) =>
                  `<tr><td>${esc(u.workPackageCode.replace(/_/g, ' '))}</td><td>${u.quantity}</td><td class="muted">${esc(u.reason)}</td></tr>`,
              )
              .join('')}
</tbody></table>
<p class="muted">These are excluded from the range above. They are not zero-hour work.</p>`
          : ''}
<ul class="muted">${e.caveats.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`
      : '<p class="muted">No estimate available: this organization has no effort templates configured.</p>'}

<h2>Assumptions</h2>
<p class="muted">Each is a proposition accepted temporarily for estimating, with the consequence of
being wrong stated next to it. An assumption that has been invalidated stays listed: the scope built
on it is what has to be revisited.</p>
${ctx.assumptions.length
      ? `<table><thead><tr><th>Assumption</th><th>Basis</th><th>Consequence if false</th><th>State</th></tr></thead><tbody>
${ctx.assumptions
          .map(
            (a) =>
              `<tr><td>${esc(a.statement)}</td><td class="muted">${esc(a.basis)}</td>
                <td class="muted">${esc(a.consequenceIfFalse)}</td>
                <td class="state ${a.validationState === 'INVALIDATED' ? 'BLOCKED' : a.validationState === 'VALIDATED' ? 'PASS' : 'UNKNOWN'}">
                  ${esc(a.validationState)}</td></tr>`,
          )
          .join('')}
</tbody></table>`
      : '<p class="muted">None recorded. Nothing in this package rests on a stated assumption.</p>'}

<h2>Exclusions</h2>
${approvedExclusions.length
      ? `<table><thead><tr><th>Scope area</th><th>Reason</th><th>Related unknown</th></tr></thead><tbody>
${approvedExclusions
          .map(
            (e) =>
              `<tr><td>${esc(e.scopeArea)}</td><td class="muted">${esc(e.reason)}</td>
                <td class="muted">${esc(e.relatedUnknowns.join(', ') || '—')}</td></tr>`,
          )
          .join('')}
</tbody></table>`
      : '<p class="muted">No exclusion has been approved. Nothing is excluded from this scope.</p>'}
${proposedExclusions.length
      ? `<h2>Proposed exclusions — NOT APPROVED</h2>
<p class="muted">These have not been approved by a commercial reviewer and are therefore NOT
excluded from the scope above. They are shown so the decision is visible rather than implied.</p>
<table><thead><tr><th>Scope area</th><th>Reason</th></tr></thead><tbody>
${proposedExclusions
          .map((e) => `<tr><td>${esc(e.scopeArea)}</td><td class="muted">${esc(e.reason)}</td></tr>`)
          .join('')}
</tbody></table>`
      : ''}

<h2>Allowances and blockers</h2>
<table><thead><tr><th>Unknown</th><th>Profile</th><th>Commercial treatment</th></tr></thead><tbody>
${r.unknowns
      .map(
        (u: any) =>
          `<tr><td>${esc(u.missing_information)}</td>
            <td class="state UNKNOWN">${esc(u.estimate_allowance_profile.replace(/_/g, ' '))}</td>
            <td class="muted">${esc(u.commercial_impact)}</td></tr>`,
      )
      .join('')}
</tbody></table>
${blockers.length
      ? `<p class="state BLOCKED">${blockers.length} unknown(s) must be resolved before a fixed price. No allowance substitutes for them.</p>`
      : ''}

<h2>Candidate bill of materials</h2>
<div class="stamp">CANDIDATE — NOT RELEASED FOR PROCUREMENT</div>
<table><thead><tr><th>Replaces</th><th>Candidate</th><th>Qty</th><th>Note</th></tr></thead><tbody>
${r.candidate_bom
      .map(
        (b: any) =>
          `<tr><td>${esc(b.replaces)}</td><td>${esc(b.catalog)}</td><td>${b.quantity}</td><td class="muted">${esc(b.note)}</td></tr>`,
      )
      .join('')}
</tbody></table>`,
  );
}

function customerInformationRequest(ctx: Ctx): string {
  const r = ctx.result;
  const missingEvidence = [
    ...new Set(r.evidence_coverage.flatMap((d: any) => d.missing as string[])),
  ];
  return shell(
    ctx,
    `<p>To progress this opportunity, ${esc(ctx.opportunity.customerName)} is asked to supply the
information below. Until it arrives, the items it affects cannot be scoped, and a fixed price
cannot responsibly be offered.</p>

<h2>Information required</h2>
<table><thead><tr><th>#</th><th>What is needed</th><th>Why it is needed</th><th>How to obtain it</th><th>Priority</th></tr></thead><tbody>
${r.unknowns
      .map(
        (u: any, i: number) =>
          `<tr><td>${i + 1}</td><td><strong>${esc(u.missing_information)}</strong></td>
            <td class="muted">${esc(u.technical_impact)}</td>
            <td class="muted">${esc(u.recommended_resolution)}</td>
            <td class="state ${u.estimate_allowance_profile === 'RESOLVE_BEFORE_QUOTE' ? 'BLOCKED' : 'UNKNOWN'}">
              ${u.estimate_allowance_profile === 'RESOLVE_BEFORE_QUOTE' ? 'REQUIRED FOR FIXED PRICE' : 'REQUESTED'}</td></tr>`,
      )
      .join('')}
</tbody></table>

<h2>Evidence not present in the supplied files</h2>
<table><tbody>
${missingEvidence.map((m) => `<tr><td>${esc(String(m).replace(/_/g, ' '))}</td></tr>`).join('')}
</tbody></table>

<h2>What was received</h2>
<table><thead><tr><th>Domain</th><th>Coverage</th></tr></thead><tbody>
${r.evidence_coverage
      .map((d: any) => `<tr><td>${esc(d.domain.replace(/_/g, ' '))}</td><td>${d.percent}%</td></tr>`)
      .join('')}
</tbody></table>`,
  );
}

const RENDERERS: Record<ReportKind, (ctx: Ctx) => string> = {
  ENGINEERING_PREFLIGHT: engineeringPreflight,
  PROPOSAL_INPUT_PACKAGE: proposalInputPackage,
  CUSTOMER_INFORMATION_REQUEST: customerInformationRequest,
};

class GenerateReportDto {
  @IsIn(['ENGINEERING_PREFLIGHT', 'PROPOSAL_INPUT_PACKAGE', 'CUSTOMER_INFORMATION_REQUEST'])
  kind: ReportKind;
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estimating: EstimatingService,
    private readonly commercial: CommercialService,
    private readonly audit: AuditService,
  ) {}

  async generate(user: Principal, opportunityId: string, kind: ReportKind) {
    const opportunity = await this.prisma.opportunity.findFirst({
      where: { id: opportunityId, tenantId: user.tenantId },
    });
    if (!opportunity) throw new NotFoundException('opportunity not found');

    const analysis = await this.prisma.analysis.findFirst({
      where: { opportunityId, failed: false },
      orderBy: { startedAt: 'desc' },
    });
    if (!analysis?.result) throw new NotFoundException('this opportunity has no completed analysis');

    const tenant = await this.prisma.tenant.findFirstOrThrow({ where: { id: user.tenantId } });
    const preparer = await this.prisma.user.findFirst({ where: { id: user.userId } });
    const estimate =
      kind === 'PROPOSAL_INPUT_PACKAGE'
        ? await this.estimating.estimate(user.tenantId, opportunityId).catch(() => null)
        : null;

    const { assumptions, exclusions } = await this.commercial.list(user.tenantId, opportunityId);

    const html = RENDERERS[kind]({
      kind,
      tenant,
      opportunity: opportunity as any,
      analysis,
      result: analysis.result as any,
      estimate,
      assumptions,
      exclusions,
      generatedByName: preparer?.name ?? user.email,
      generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
    });

    const body = Buffer.from(html, 'utf8');
    const sha256 = createHash('sha256').update(body).digest('hex');
    const relative = join('reports', user.tenantId, `${analysis.id}-${kind}-${sha256.slice(0, 12)}.html`);
    const absolute = join(storageRoot(), relative);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, body);

    const report = await this.prisma.report.create({
      data: {
        analysisId: analysis.id,
        kind,
        storageLocation: relative.split('\\').join('/'),
        sha256,
        sizeBytes: body.length,
        reportSchemaVersion: REPORT_SCHEMA_VERSION,
        generatedBy: user.userId,
      },
    });
    await this.audit.record(user.tenantId, user.userId, 'report.generated', 'Report', report.id, {
      opportunityId,
      analysisId: analysis.id,
      kind,
      sha256,
    });
    return report;
  }

  async list(tenantId: string, opportunityId: string) {
    const analyses = await this.prisma.analysis.findMany({
      where: { opportunityId, opportunity: { tenantId } },
      select: { id: true },
    });
    return this.prisma.report.findMany({
      where: { analysisId: { in: analyses.map((a) => a.id) } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async html(tenantId: string, reportId: string) {
    const report = await this.prisma.report.findFirst({
      where: { id: reportId, analysis: { opportunity: { tenantId } } },
    });
    if (!report) throw new NotFoundException('report not found');
    return readFile(join(storageRoot(), report.storageLocation), 'utf8');
  }
}

@Controller()
@UseGuards(AuthGuard)
export class ReportsController {
  constructor(private readonly svc: ReportsService) {}

  @Get('opportunities/:id/reports')
  list(@CurrentUser() user: Principal, @Param('id') id: string) {
    return this.svc.list(user.tenantId, id);
  }

  @Post('opportunities/:id/reports')
  @Roles(Role.ORG_ADMIN, Role.CONTROLS_ENGINEER, Role.ESTIMATOR, Role.PROJECT_MANAGER)
  generate(
    @CurrentUser() user: Principal,
    @Param('id') id: string,
    @Body() dto: GenerateReportDto,
  ) {
    return this.svc.generate(user, id, dto.kind);
  }

  @Get('reports/:reportId')
  @Header('content-type', 'text/html; charset=utf-8')
  async view(@CurrentUser() user: Principal, @Param('reportId') reportId: string, @Res() res: any) {
    res.header('content-type', 'text/html; charset=utf-8');
    return res.send(await this.svc.html(user.tenantId, reportId));
  }
}

@Module({
  imports: [AuthModule, AuditModule, EstimatingModule, CommercialModule],
  controllers: [ReportsController],
  providers: [ReportsService, PrismaService],
})
export class ReportsModule {}
