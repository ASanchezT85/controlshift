'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { api, sessionUser } from '@/lib/api';

interface Finding {
  id: string;
  category: string;
  title: string;
  description: string;
  state: string;
  severity: string;
  quantity?: number;
  work_packages: string[];
  evidence: { source_type: string; publication_id?: string; locator?: string }[];
}

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
  work_packages: { code: string; quantity: number; triggered_by: string[] }[];
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
}

interface Opportunity {
  id: string;
  name: string;
  customerName: string;
  facilityName: string;
  proposalType: string;
  shutdownRequirementHours: number | null;
  engineeringReviewComplete: boolean;
  shutdownFeasible: boolean;
  artifacts: { id: string; originalFilename: string; artifactType: string; size: number }[];
}

export default function OpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [opportunity, setOpportunity] = useState<Opportunity | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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

      {!r && (
        <div className="card">
          <p className="muted">No completed analysis yet.</p>
        </div>
      )}

      {r && (
        <>
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

          <div className="card">
            <h2>Findings ({r.findings.length})</h2>
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>State</th>
                    <th>Finding</th>
                    <th>Qty</th>
                    <th>Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {r.findings.map((f) => (
                    <tr key={f.id}>
                      <td>{f.id}</td>
                      <td>
                        <span className={`state ${f.state}`}>{f.state.replace(/_/g, ' ')}</span>
                      </td>
                      <td>
                        <strong>{f.title}</strong>
                        <div className="muted" style={{ fontSize: 13 }}>
                          {f.description}
                        </div>
                      </td>
                      <td>{f.quantity ?? '—'}</td>
                      <td className="muted" style={{ fontSize: 13 }}>
                        {f.evidence
                          .map((e) => e.publication_id ?? e.locator ?? e.source_type)
                          .join('; ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

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
                    <th>Units</th>
                    <th>Triggered by</th>
                  </tr>
                </thead>
                <tbody>
                  {r.work_packages.map((w) => (
                    <tr key={w.code}>
                      <td>{w.code.replace(/_/g, ' ')}</td>
                      <td>{w.quantity}</td>
                      <td className="muted">{w.triggered_by.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
