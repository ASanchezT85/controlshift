'use client';

import { useState } from 'react';
import { api } from '@/lib/api';

const PROPOSAL_TYPES = [
  ['FIXED_PRICE', 'Fixed price'],
  ['BUDGETARY', 'Budgetary'],
  ['ROM', 'ROM'],
  ['TIME_AND_MATERIAL', 'Time and material'],
  ['DISCOVERY_ONLY', 'Discovery only'],
] as const;

const EMPTY = {
  name: '',
  customerName: '',
  facilityName: '',
  proposalType: 'FIXED_PRICE',
  shutdownRequirementHours: '',
  commercialNotes: '',
};

export default function NewOpportunity({
  role,
  onCreated,
}: {
  role: string;
  onCreated: () => Promise<void> | void;
}) {
  const [showing, setShowing] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (role === 'VIEWER') return null;

  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value });

  const ready =
    form.name.trim().length > 1 &&
    form.customerName.trim().length > 1 &&
    form.facilityName.trim().length > 1;

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await api('/opportunities', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name.trim(),
          customerName: form.customerName.trim(),
          facilityName: form.facilityName.trim(),
          proposalType: form.proposalType,
          // The shutdown window is a commercial constraint, not a default:
          // absent means not supplied, and readiness says so.
          shutdownRequirementHours: form.shutdownRequirementHours
            ? Number(form.shutdownRequirementHours)
            : undefined,
          commercialNotes: form.commercialNotes.trim() || undefined,
        }),
      });
      setForm({ ...EMPTY });
      setShowing(false);
      await onCreated();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!showing) {
    return (
      <p style={{ marginTop: 0 }}>
        <button onClick={() => setShowing(true)}>New opportunity</button>
      </p>
    );
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div className="inline-form">
        <input placeholder="Opportunity name" value={form.name} onChange={set('name')} />
        <input placeholder="Customer" value={form.customerName} onChange={set('customerName')} />
        <input placeholder="Facility" value={form.facilityName} onChange={set('facilityName')} />
      </div>
      <div className="inline-form">
        <select value={form.proposalType} onChange={set('proposalType')}>
          {PROPOSAL_TYPES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <input
          placeholder="Max shutdown (hours)"
          inputMode="numeric"
          value={form.shutdownRequirementHours}
          onChange={set('shutdownRequirementHours')}
        />
        <input
          placeholder="Commercial notes"
          value={form.commercialNotes}
          onChange={set('commercialNotes')}
        />
      </div>
      <div className="inline-form">
        <button disabled={busy || !ready} onClick={submit}>
          {busy ? 'Creating…' : 'Create'}
        </button>
        <button
          className="ghost"
          disabled={busy}
          onClick={() => {
            setShowing(false);
            setError('');
          }}
        >
          Cancel
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
