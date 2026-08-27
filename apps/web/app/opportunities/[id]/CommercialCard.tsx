'use client';

import { useState } from 'react';
import { api } from '@/lib/api';

export interface Assumption {
  id: string;
  statement: string;
  basis: string;
  consequenceIfFalse: string;
  affectedScope: string[];
  validationState: 'ASSUMED' | 'VALIDATED' | 'INVALIDATED';
  sourceUnknownId: string | null;
}

export interface Exclusion {
  id: string;
  scopeArea: string;
  reason: string;
  relatedUnknowns: string[];
  approvedBy: string | null;
  approvedAt: string | null;
}

const STATE_CLASS: Record<Assumption['validationState'], string> = {
  ASSUMED: 'UNKNOWN',
  VALIDATED: 'PASS',
  INVALIDATED: 'BLOCKED',
};

export default function CommercialCard({
  opportunityId,
  role,
  assumptions,
  exclusions,
  hasAnalysis,
  onChange,
}: {
  opportunityId: string;
  role: string;
  assumptions: Assumption[];
  exclusions: Exclusion[];
  hasAnalysis: boolean;
  onChange: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [draft, setDraft] = useState({ statement: '', basis: '', consequenceIfFalse: '' });
  const [exDraft, setExDraft] = useState({ scopeArea: '', reason: '' });

  // Separation of duties (SPEC 37): technical validation and commercial
  // approval are different acts by different people.
  const mayValidate = role === 'CONTROLS_ENGINEER' || role === 'ORG_ADMIN';
  const mayApprove = role === 'ESTIMATOR' || role === 'PROJECT_MANAGER' || role === 'ORG_ADMIN';
  const mayEdit = role !== 'VIEWER';

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError('');
    try {
      await fn();
      await onChange();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="card">
      <h2>Assumptions and exclusions</h2>
      {error && <p className="error">{error}</p>}

      {mayEdit && hasAnalysis && (
        <p style={{ marginTop: 0 }}>
          <button
            className="ghost"
            disabled={!!busy}
            onClick={() =>
              act('propose', () =>
                api(`/opportunities/${opportunityId}/commercial/propose`, {
                  method: 'POST',
                  body: '{}',
                }),
              )
            }
          >
            {busy === 'propose' ? 'Proposing…' : 'Propose from analysis'}
          </button>{' '}
          <span className="muted" style={{ fontSize: 13 }}>
            drafts propositions from the unknowns. It proposes; it never approves.
          </span>
        </p>
      )}

      <h3 style={{ fontSize: 13, color: 'var(--muted)', letterSpacing: '0.05em' }}>
        ASSUMPTIONS ({assumptions.length})
      </h3>
      {assumptions.length === 0 && (
        <p className="muted">None recorded. Nothing in the scope rests on a stated assumption.</p>
      )}
      {assumptions.length > 0 && (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Assumption</th>
                <th>Consequence if false</th>
                <th>State</th>
                {mayValidate && <th />}
              </tr>
            </thead>
            <tbody>
              {assumptions.map((a) => (
                <tr key={a.id}>
                  <td>
                    {a.statement}
                    <div className="muted" style={{ fontSize: 12 }}>
                      {a.basis}
                    </div>
                  </td>
                  <td className="muted">{a.consequenceIfFalse}</td>
                  <td>
                    <span className={`state ${STATE_CLASS[a.validationState]}`}>
                      {a.validationState}
                    </span>
                  </td>
                  {mayValidate && (
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {a.validationState === 'ASSUMED' && (
                        <>
                          <button
                            className="ghost"
                            disabled={!!busy}
                            onClick={() =>
                              act(a.id, () =>
                                api(`/assumptions/${a.id}`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({ validationState: 'VALIDATED' }),
                                }),
                              )
                            }
                          >
                            Validate
                          </button>{' '}
                          <button
                            className="ghost"
                            disabled={!!busy}
                            onClick={() =>
                              act(a.id, () =>
                                api(`/assumptions/${a.id}`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({ validationState: 'INVALIDATED' }),
                                }),
                              )
                            }
                          >
                            Invalidate
                          </button>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {mayEdit && (
        <div className="inline-form">
          <input
            placeholder="Assumption statement"
            value={draft.statement}
            onChange={(e) => setDraft({ ...draft, statement: e.target.value })}
          />
          <input
            placeholder="Basis"
            value={draft.basis}
            onChange={(e) => setDraft({ ...draft, basis: e.target.value })}
          />
          <input
            placeholder="Consequence if false"
            value={draft.consequenceIfFalse}
            onChange={(e) => setDraft({ ...draft, consequenceIfFalse: e.target.value })}
          />
          <button
            disabled={
              !!busy ||
              !draft.statement.trim() ||
              !draft.basis.trim() ||
              !draft.consequenceIfFalse.trim()
            }
            onClick={() =>
              act('new-assumption', async () => {
                await api(`/opportunities/${opportunityId}/assumptions`, {
                  method: 'POST',
                  body: JSON.stringify(draft),
                });
                setDraft({ statement: '', basis: '', consequenceIfFalse: '' });
              })
            }
          >
            Add
          </button>
        </div>
      )}

      <h3 style={{ fontSize: 13, color: 'var(--muted)', letterSpacing: '0.05em', marginTop: 24 }}>
        EXCLUSIONS ({exclusions.filter((e) => e.approvedBy).length} approved,{' '}
        {exclusions.filter((e) => !e.approvedBy).length} proposed)
      </h3>
      {exclusions.length === 0 && (
        <p className="muted">Nothing is excluded from this scope.</p>
      )}
      {exclusions.length > 0 && (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Scope area</th>
                <th>Reason</th>
                <th>State</th>
                {(mayApprove || mayEdit) && <th />}
              </tr>
            </thead>
            <tbody>
              {exclusions.map((x) => (
                <tr key={x.id}>
                  <td>{x.scopeArea}</td>
                  <td className="muted">{x.reason}</td>
                  <td>
                    <span className={`state ${x.approvedBy ? 'PASS' : 'UNKNOWN'}`}>
                      {x.approvedBy ? 'APPROVED' : 'PROPOSED'}
                    </span>
                  </td>
                  {(mayApprove || mayEdit) && (
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {!x.approvedBy && mayApprove && (
                        <button
                          className="ghost"
                          disabled={!!busy}
                          onClick={() =>
                            act(x.id, () =>
                              api(`/exclusions/${x.id}/approve`, { method: 'PATCH', body: '{}' }),
                            )
                          }
                        >
                          Approve
                        </button>
                      )}{' '}
                      {!x.approvedBy && mayEdit && (
                        <button
                          className="ghost"
                          disabled={!!busy}
                          onClick={() =>
                            act(x.id, () => api(`/exclusions/${x.id}`, { method: 'DELETE' }))
                          }
                        >
                          Withdraw
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {exclusions.some((e) => !e.approvedBy) && (
        <p className="notice">
          A proposed exclusion is not excluded. Until a commercial reviewer approves it, the
          proposal package still carries that scope.
        </p>
      )}

      {mayEdit && (
        <div className="inline-form">
          <input
            placeholder="Scope area"
            value={exDraft.scopeArea}
            onChange={(e) => setExDraft({ ...exDraft, scopeArea: e.target.value })}
          />
          <input
            placeholder="Reason"
            value={exDraft.reason}
            onChange={(e) => setExDraft({ ...exDraft, reason: e.target.value })}
          />
          <button
            disabled={!!busy || !exDraft.scopeArea.trim() || exDraft.reason.trim().length < 4}
            onClick={() =>
              act('new-exclusion', async () => {
                await api(`/opportunities/${opportunityId}/exclusions`, {
                  method: 'POST',
                  body: JSON.stringify(exDraft),
                });
                setExDraft({ scopeArea: '', reason: '' });
              })
            }
          >
            Propose
          </button>
        </div>
      )}
    </div>
  );
}
