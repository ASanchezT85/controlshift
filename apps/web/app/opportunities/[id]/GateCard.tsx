'use client';

import { useState } from 'react';
import { api } from '@/lib/api';

/**
 * The two human determinations of the SPEC 35 gate. The engine cannot make
 * them and never assumes them: until somebody sets them here, fixed-price
 * readiness stays NOT READY no matter how complete the evidence is.
 */
export default function GateCard({
  opportunityId,
  engineeringReviewComplete,
  shutdownFeasible,
  shutdownHours,
  role,
  reasons,
  onChange,
}: {
  opportunityId: string;
  engineeringReviewComplete: boolean;
  shutdownFeasible: boolean;
  shutdownHours: number | null;
  role: string;
  reasons: string[];
  onChange: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const mayDecide =
    role === 'CONTROLS_ENGINEER' || role === 'PROJECT_MANAGER' || role === 'ORG_ADMIN';

  const set = async (key: string, value: boolean) => {
    setBusy(key);
    setError('');
    try {
      await api(`/opportunities/${opportunityId}/review-state`, {
        method: 'PATCH',
        body: JSON.stringify({ [key]: value }),
      });
      await onChange();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const row = (
    key: 'engineeringReviewComplete' | 'shutdownFeasible',
    label: string,
    value: boolean,
    detail: string,
  ) => (
    <tr>
      <td>
        <strong>{label}</strong>
        <div className="muted" style={{ fontSize: 13 }}>
          {detail}
        </div>
      </td>
      <td>
        <span className={`state ${value ? 'PASS' : 'UNKNOWN'}`}>
          {value ? 'ESTABLISHED' : 'NOT ESTABLISHED'}
        </span>
      </td>
      {mayDecide && (
        <td style={{ whiteSpace: 'nowrap' }}>
          <button className="ghost" disabled={!!busy} onClick={() => set(key, !value)}>
            {busy === key ? '…' : value ? 'Withdraw' : 'Confirm'}
          </button>
        </td>
      )}
    </tr>
  );

  return (
    <div className="card">
      <h2>Human determinations</h2>
      {error && <p className="error">{error}</p>}
      <div className="scroll">
        <table>
          <tbody>
            {row(
              'engineeringReviewComplete',
              'Engineering review complete',
              engineeringReviewComplete,
              'Every finding has been reviewed by a controls engineer. The engine cannot know this.',
            )}
            {row(
              'shutdownFeasible',
              'Shutdown feasible',
              shutdownFeasible,
              shutdownHours
                ? `The migration can be executed within the ${shutdownHours} h window the customer allows.`
                : 'No shutdown requirement has been supplied for this opportunity.',
            )}
          </tbody>
        </table>
      </div>
      {reasons.length > 0 && (
        <p className="notice" style={{ marginBottom: 0 }}>
          Fixed price is refused for {reasons.length} reason{reasons.length === 1 ? '' : 's'}.
          Confirming these two closes only the ones about review and shutdown — unresolved
          blockers, critical unknowns and coverage are not settled by a checkbox.
        </p>
      )}
    </div>
  );
}
