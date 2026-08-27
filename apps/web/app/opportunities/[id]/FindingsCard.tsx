'use client';

import { useState } from 'react';
import { api } from '@/lib/api';

export interface Finding {
  id: string;
  rule_id: string;
  category: string;
  title: string;
  description: string;
  state: string;
  severity: string;
  quantity?: number;
  source_entities: string[];
  evidence: { source_type: string; publication_id?: string; locator?: string }[];
}

export interface Review {
  id: string;
  findingId: string;
  action: string;
  reason: string | null;
  overrideState: string | null;
  createdAt: string;
}

const ACTIONS = ['ACKNOWLEDGE', 'ACCEPT', 'REJECT', 'RESOLVE', 'OVERRIDE'] as const;

export default function FindingsCard({
  opportunityId,
  analysisId,
  findings,
  reviews,
  role,
  onChange,
}: {
  opportunityId: string;
  analysisId: string;
  findings: Finding[];
  reviews: Review[];
  role: string;
  onChange: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState<string>('');
  const [action, setAction] = useState<string>('ACKNOWLEDGE');
  const [reason, setReason] = useState('');
  const [overrideState, setOverrideState] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const mayReview = role === 'CONTROLS_ENGINEER' || role === 'ORG_ADMIN';
  const byFinding = new Map<string, Review[]>();
  for (const r of reviews) {
    byFinding.set(r.findingId, [...(byFinding.get(r.findingId) ?? []), r]);
  }

  const submit = async (findingId: string) => {
    setBusy(true);
    setError('');
    try {
      await api(`/opportunities/${opportunityId}/analyses/${analysisId}/reviews`, {
        method: 'POST',
        body: JSON.stringify({
          findingId,
          action,
          reason: reason || undefined,
          overrideState: action === 'OVERRIDE' ? overrideState || undefined : undefined,
        }),
      });
      setOpen('');
      setReason('');
      setOverrideState('');
      setAction('ACKNOWLEDGE');
      await onChange();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h2>
        Findings ({findings.length})
        <span style={{ float: 'right', textTransform: 'none', letterSpacing: 0, fontSize: 13 }}>
          {reviews.length} review{reviews.length === 1 ? '' : 's'} recorded
        </span>
      </h2>
      {error && <p className="error">{error}</p>}
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>State</th>
              <th>Finding</th>
              <th>Qty</th>
              <th>Evidence</th>
              {mayReview && <th />}
            </tr>
          </thead>
          <tbody>
            {findings.map((f) => {
              const mine = byFinding.get(f.id) ?? [];
              return (
                <tr key={f.id}>
                  <td>{f.id}</td>
                  <td>
                    <span className={`state ${f.state}`}>{f.state.replace(/_/g, ' ')}</span>
                    {mine.length > 0 && (
                      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                        {mine.map((r) => (
                          <div key={r.id}>
                            {r.action.toLowerCase()}
                            {r.overrideState ? ` → ${r.overrideState}` : ''}
                            {r.reason ? ` · ${r.reason}` : ''}
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td>
                    <strong>{f.title}</strong>
                    <div className="muted" style={{ fontSize: 13 }}>
                      {f.description}
                    </div>
                    {open === f.id && (
                      <div className="inline-form">
                        <select value={action} onChange={(e) => setAction(e.target.value)}>
                          {ACTIONS.map((a) => (
                            <option key={a} value={a}>
                              {a.toLowerCase()}
                            </option>
                          ))}
                        </select>
                        {action === 'OVERRIDE' && (
                          <select
                            value={overrideState}
                            onChange={(e) => setOverrideState(e.target.value)}
                          >
                            <option value="">override state…</option>
                            {['PASS', 'CONDITIONAL', 'REVIEW_REQUIRED', 'BLOCKED', 'UNKNOWN'].map(
                              (s) => (
                                <option key={s} value={s}>
                                  {s.replace(/_/g, ' ')}
                                </option>
                              ),
                            )}
                          </select>
                        )}
                        <input
                          placeholder={
                            action === 'OVERRIDE' ? 'Reason (required for an override)' : 'Reason'
                          }
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                        />
                        <button
                          disabled={busy || (action === 'OVERRIDE' && !reason.trim())}
                          onClick={() => submit(f.id)}
                        >
                          Record
                        </button>
                        <button className="ghost" disabled={busy} onClick={() => setOpen('')}>
                          Cancel
                        </button>
                      </div>
                    )}
                  </td>
                  <td>{f.quantity ?? '—'}</td>
                  <td className="muted" style={{ fontSize: 13 }}>
                    {f.evidence
                      .map((e) => e.publication_id ?? e.locator ?? e.source_type)
                      .join('; ')}
                  </td>
                  {mayReview && (
                    <td>
                      {open !== f.id && (
                        <button className="ghost" onClick={() => setOpen(f.id)}>
                          Review
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
        A review is recorded beside the finding, never on top of it. The original state stays in the
        stored analysis, and an override keeps the reviewer, the reason and the timestamp.
      </p>
    </div>
  );
}
