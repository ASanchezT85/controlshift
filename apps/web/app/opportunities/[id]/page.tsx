'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { api, sessionUser, token } from '@/lib/api';
import ArtifactsCard from './ArtifactsCard';
import CommercialCard, { type Assumption, type Exclusion } from './CommercialCard';
import FindingsCard, { type Finding, type Review } from './FindingsCard';
import GateCard from './GateCard';

const API = process.env.NEXT_PUBLIC_API ?? 'http://127.0.0.1:3000/api';

interface EstimateLine {
  workPackageCode: string;
  unitType: string;
  role: string;
  quantity: number;
  minHours: number;
  maxHours: number;
}

interface Estimate {
  lines: EstimateLine[];
  unpriced: { workPackageCode: string; unitType: string; quantity: number; reason: string }[];
  totals: {
    minHours: number;
    maxHours: number;
    uncertaintyAllowancePercent: number;
    minHoursWithAllowance: number;
    maxHoursWithAllowance: number;
  };
  caveats: string[];
}

interface ReportRow {
  id: string;
  kind: string;
  createdAt: string;
  sizeBytes: number;
}

const REPORT_KINDS = [
  ['ENGINEERING_PREFLIGHT', 'Engineering Preflight'],
  ['PROPOSAL_INPUT_PACKAGE', 'Proposal Input Package'],
  ['CUSTOMER_INFORMATION_REQUEST', 'Customer Information Request'],
] as const;

interface AnalysisResult {
  versions: Record<string, string>;
  system_model: {
    processor: string;
    chassis: string;
    modules: { slot: number; catalog: string }[];
    programs: { number: number; name: string; rungs: unknown[] }[];
    sti?: { interval_ms: number } | null;
  };
  evidence_coverage: { domain: string; percent: number; missing: string[] }[];
  findings: Finding[];
  unknowns: {
    id: string;
    missing_information: string;
    commercial_impact: string;
    recommended_resolution: string;
    estimate_allowance_profile: string;
  }[];
  migration_paths: {
    id: string;
    name: string;
    conclusion: string;
    lifecycle_risk: string;
    preferred: boolean;
    blocking_findings: string[];
    notes: string[];
  }[];
  work_packages: { code: string; unit_type: string; quantity: number; triggered_by: string[] }[];
  candidate_bom: { catalog: string; quantity: number; replaces: string; state: string }[];
  quote_readiness: {
    fixed_price: string;
    budgetary: string;
    time_and_material: string;
    reasons: string[];
  };
}

interface Analysis {
  id: string;
  startedAt: string;
  rulePackVersion: string;
  analysisEngineVersion: string;
  result: AnalysisResult;
  reviews: Review[];
  engineeringReviewComplete: boolean;
  shutdownFeasible: boolean;
}

interface Opportunity {
  id: string;
  updatedAt: string;
  name: string;
  customerName: string;
  facilityName: string;
  proposalType: string;
  shutdownRequirementHours: number | null;
  engineeringReviewComplete: boolean;
  shutdownFeasible: boolean;
  artifacts: {
    id: string;
    originalFilename: string;
    artifactType: string;
    size: number;
    processingStatus: string;
  }[];
}

export default function OpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [opportunity, setOpportunity] = useState<Opportunity | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [commercial, setCommercial] = useState<{
    assumptions: Assumption[];
    exclusions: Exclusion[];
  }>({ assumptions: [], exclusions: [] });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setOpportunity(await api<Opportunity>(`/opportunities/${id}`));
    } catch (e: any) {
      setError(e.message);
      return;
    }
    try {
      setAnalysis(await api<Analysis>(`/opportunities/${id}/analyses/latest`));
    } catch {
      setAnalysis(null);
    }
    try {
      setEstimate(await api<Estimate>(`/opportunities/${id}/estimate`));
    } catch {
      setEstimate(null);
    }
    try {
      setReports(await api<ReportRow[]>(`/opportunities/${id}/reports`));
    } catch {
      setReports([]);
    }
    try {
      setCommercial(
        await api<{ assumptions: Assumption[]; exclusions: Exclusion[] }>(
          `/opportunities/${id}/commercial`,
        ),
      );
    } catch {
      setCommercial({ assumptions: [], exclusions: [] });
    }
  }, [id]);

  useEffect(() => {
    if (!sessionUser()) {
      setError('Sign in first.');
      return;
    }
    load();
  }, [load]);

  const run = async () => {
    setBusy(true);
    setError('');
    try {
      await api(`/opportunities/${id}/analyses`, { method: 'POST', body: '{}' });
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const generate = async (kind: string) => {
    setGenerating(kind);
    setError('');
    try {
      await api(`/opportunities/${id}/reports`, {
        method: 'POST',
        body: JSON.stringify({ kind }),
      });
      setReports(await api<ReportRow[]>(`/opportunities/${id}/reports`));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGenerating('');
    }
  };

  // The report endpoint needs the bearer token, so a plain link cannot open it.
  const openReport = async (reportId: string) => {
    const res = await fetch(`${API}/reports/${reportId}`, {
      headers: { authorization: `Bearer ${token()}` },
    });
    const html = await res.text();
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    window.open(url, '_blank');
  };

  if (error && !opportunity) {
    return (
      <div className="card">
        <p className="error">{error}</p>
        <Link href="/">Back</Link>
      </div>
    );
  }
  if (!opportunity) return <p className="muted">Loading…</p>;

  const r = analysis?.result;
  // A stored analysis is never rewritten (SPEC 24). Compare the determinations
  // it was computed with against the ones in force now - timestamps cannot be
  // used, because running the analysis itself touches the opportunity.
  const stale =
    !!analysis &&
    (analysis.engineeringReviewComplete !== opportunity.engineeringReviewComplete ||
      analysis.shutdownFeasible !== opportunity.shutdownFeasible);

  return (
    <>
      <div className="card">
        <h2>
          {opportunity.name}
          <span style={{ float: 'right', textTransform: 'none', letterSpacing: 0 }}>
            <Link href="/">All opportunities</Link>
          </span>
        </h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {opportunity.customerName} · {opportunity.facilityName} ·{' '}
          {opportunity.proposalType.replace(/_/g, ' ')} · shutdown{' '}
          {opportunity.shutdownRequirementHours ?? '—'} h · {opportunity.artifacts.length} artifacts
        </p>
        <button onClick={run} disabled={busy}>
          {busy ? 'Analyzing…' : analysis ? 'Re-analyze' : 'Run analysis'}
        </button>
        {error && <p className="error">{error}</p>}
      </div>

      <ArtifactsCard
        opportunityId={id}
        artifacts={opportunity.artifacts}
        onChange={load}
      />

      {!r && (
        <div className="card">
          <p className="muted">No completed analysis yet.</p>
        </div>
      )}

      {r && (
        <>
          {stale && (
            <p className="notice">
              This verdict was computed before the latest change to the opportunity. Re-analyze to
              refresh it — the stored assessment is never rewritten in place.
            </p>
          )}

          <div className="card">
            <h2>Quote readiness</h2>
            <div className="verdict">
              <div>
                <small>Fixed price</small>
                <strong className={r.quote_readiness.fixed_price}>
                  {r.quote_readiness.fixed_price.replace(/_/g, ' ')}
                </strong>
              </div>
              <div>
                <small>Budgetary</small>
                <strong className={r.quote_readiness.budgetary}>
                  {r.quote_readiness.budgetary.replace(/_/g, ' ')}
                </strong>
              </div>
              <div>
                <small>Time and material</small>
                <strong className={r.quote_readiness.time_and_material}>
                  {r.quote_readiness.time_and_material.replace(/_/g, ' ')}
                </strong>
              </div>
            </div>
            {r.quote_readiness.reasons.length > 0 && (
              <ul className="muted" style={{ fontSize: 14 }}>
                {r.quote_readiness.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}
          </div>

          <GateCard
            opportunityId={id}
            engineeringReviewComplete={opportunity.engineeringReviewComplete}
            shutdownFeasible={opportunity.shutdownFeasible}
            shutdownHours={opportunity.shutdownRequirementHours}
            role={sessionUser()?.role ?? 'VIEWER'}
            reasons={r.quote_readiness.reasons}
            onChange={load}
          />

          <div className="card">
            <h2>Reconstructed system</h2>
            <p style={{ marginTop: 0 }}>
              {r.system_model.processor} in {r.system_model.chassis} ·{' '}
              {r.system_model.modules.length} slots · {r.system_model.programs.length} program files
              · {r.system_model.programs.reduce((n, p) => n + p.rungs.length, 0)} rungs
              {r.system_model.sti ? ` · STI ${r.system_model.sti.interval_ms} ms` : ''}
            </p>
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Slot</th>
                    <th>Catalog</th>
                    <th>Candidate replacement</th>
                  </tr>
                </thead>
                <tbody>
                  {r.system_model.modules.map((m) => {
                    const bom = r.candidate_bom.find((b) => b.replaces === m.catalog);
                    return (
                      <tr key={m.slot}>
                        <td>{m.slot}</td>
                        <td>{m.catalog}</td>
                        <td className="muted">{bom ? bom.catalog : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="notice" style={{ marginBottom: 0 }}>
              CANDIDATE — NOT RELEASED FOR PROCUREMENT
            </p>
          </div>

          <div className="card">
            <h2>Evidence coverage</h2>
            <div className="scroll">
              <table>
                <tbody>
                  {r.evidence_coverage.map((d) => (
                    <tr key={d.domain}>
                      <td style={{ width: 200 }}>{d.domain.replace(/_/g, ' ')}</td>
                      <td style={{ width: 60 }}>{d.percent}%</td>
                      <td>
                        <div className="bar">
                          <span style={{ width: `${d.percent}%` }} />
                        </div>
                      </td>
                      <td className="muted" style={{ fontSize: 13 }}>
                        {d.missing.length ? `missing: ${d.missing.join(', ')}` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <FindingsCard
            opportunityId={id}
            analysisId={analysis!.id}
            findings={r.findings}
            reviews={analysis!.reviews ?? []}
            role={sessionUser()?.role ?? 'VIEWER'}
            onChange={load}
          />

          <div className="card">
            <h2>Unknowns ({r.unknowns.length})</h2>
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Missing</th>
                    <th>Commercial impact</th>
                    <th>Resolution</th>
                    <th>Profile</th>
                  </tr>
                </thead>
                <tbody>
                  {r.unknowns.map((u) => (
                    <tr key={u.id}>
                      <td>{u.missing_information}</td>
                      <td className="muted">{u.commercial_impact}</td>
                      <td className="muted">{u.recommended_resolution}</td>
                      <td>
                        <span className="state UNKNOWN">
                          {u.estimate_allowance_profile.replace(/_/g, ' ')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h2>Migration paths</h2>
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Path</th>
                    <th>Conclusion</th>
                    <th>Lifecycle risk</th>
                    <th>Blocked by</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {r.migration_paths.map((p) => (
                    <tr key={p.id}>
                      <td>
                        {p.id} — {p.name}
                        {p.preferred && <div className="state PASS">PREFERRED</div>}
                      </td>
                      <td>{p.conclusion.replace(/_/g, ' ')}</td>
                      <td>{p.lifecycle_risk}</td>
                      <td className="state BLOCKED">{p.blocking_findings.join(', ') || '—'}</td>
                      <td className="muted" style={{ fontSize: 13 }}>
                        {p.notes.join(' ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h2>Work packages</h2>
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Package</th>
                    <th>Qty</th>
                    <th>Unit</th>
                    <th>Triggered by</th>
                  </tr>
                </thead>
                <tbody>
                  {r.work_packages.map((w) => (
                    <tr key={`${w.code}-${w.unit_type}`}>
                      <td>{w.code.replace(/_/g, ' ')}</td>
                      <td>{w.quantity}</td>
                      <td className="muted">{w.unit_type.toLowerCase()}</td>
                      <td className="muted">{w.triggered_by.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {estimate && (
            <div className="card">
              <h2>Estimate range</h2>
              <div className="scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Work package</th>
                      <th>Role</th>
                      <th>Qty</th>
                      <th>Unit</th>
                      <th>Min h</th>
                      <th>Max h</th>
                    </tr>
                  </thead>
                  <tbody>
                    {estimate.lines.map((l) => (
                      <tr key={`${l.workPackageCode}-${l.unitType}`}>
                        <td>{l.workPackageCode.replace(/_/g, ' ')}</td>
                        <td className="muted">{l.role.replace(/_/g, ' ').toLowerCase()}</td>
                        <td>{l.quantity}</td>
                        <td className="muted">{l.unitType.toLowerCase()}</td>
                        <td>{l.minHours}</td>
                        <td>{l.maxHours}</td>
                      </tr>
                    ))}
                    <tr>
                      <td colSpan={4}>
                        <strong>Priced subtotal</strong>
                      </td>
                      <td>
                        <strong>{estimate.totals.minHours}</strong>
                      </td>
                      <td>
                        <strong>{estimate.totals.maxHours}</strong>
                      </td>
                    </tr>
                    <tr>
                      <td colSpan={4} className="muted">
                        With {estimate.totals.uncertaintyAllowancePercent}% uncertainty allowance
                      </td>
                      <td>{estimate.totals.minHoursWithAllowance}</td>
                      <td>{estimate.totals.maxHoursWithAllowance}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {estimate.unpriced.length > 0 && (
                <>
                  <p className="notice">
                    Not priced, excluded from the range above — this is not zero-hour work:{' '}
                    {estimate.unpriced
                      .map((u) => `${u.workPackageCode.replace(/_/g, ' ')} (${u.quantity} ${u.unitType.toLowerCase()})`)
                      .join(', ')}
                  </p>
                </>
              )}
              <ul className="muted" style={{ fontSize: 13 }}>
                {estimate.caveats.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          )}

          <CommercialCard
            opportunityId={id}
            role={sessionUser()?.role ?? 'VIEWER'}
            assumptions={commercial.assumptions}
            exclusions={commercial.exclusions}
            hasAnalysis={!!analysis}
            onChange={load}
          />

          <div className="card">
            <h2>Deliverables</h2>
            <p style={{ marginTop: 0, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {REPORT_KINDS.map(([kind, label]) => (
                <button key={kind} className="ghost" disabled={!!generating} onClick={() => generate(kind)}>
                  {generating === kind ? 'Generating…' : `Generate ${label}`}
                </button>
              ))}
            </p>
            {reports.length === 0 && <p className="muted">No documents generated yet.</p>}
            {reports.length > 0 && (
              <div className="scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Document</th>
                      <th>Generated</th>
                      <th>Size</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {reports.map((rep) => (
                      <tr key={rep.id}>
                        <td>{rep.kind.replace(/_/g, ' ')}</td>
                        <td className="muted">{new Date(rep.createdAt).toLocaleString()}</td>
                        <td className="muted">{Math.round(rep.sizeBytes / 1024)} kB</td>
                        <td>
                          <button className="ghost" onClick={() => openReport(rep.id)}>
                            Open
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <p className="muted" style={{ fontSize: 12 }}>
            rule pack {analysis!.rulePackVersion} · engine {analysis!.analysisEngineVersion} ·
            parser {r.versions.parser_version} · IR {r.versions.ir_schema_version} · analysis{' '}
            {analysis!.id}
          </p>
        </>
      )}
    </>
  );
}

