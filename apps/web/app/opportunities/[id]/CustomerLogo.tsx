'use client';

import { useRef, useState } from 'react';
import { api } from '@/lib/api';

const MAX_LOGO_BYTES = 256 * 1024;
const ACCEPTED = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/// The end customer's mark on the cover (MASTER SPEC 39). Optional: a report
/// without it is complete, so this stays a small control rather than a card.
export default function CustomerLogo({
  opportunityId,
  customerLogo,
  customerName,
  role,
  onChange,
}: {
  opportunityId: string;
  customerLogo: string | null;
  customerName: string;
  role: string;
  onChange: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const file = useRef<HTMLInputElement>(null);

  const mayEdit = role === 'ORG_ADMIN' || role === 'ESTIMATOR' || role === 'PROJECT_MANAGER';
  if (!mayEdit && !customerLogo) return null;

  const send = async (value: string) => {
    setBusy(true);
    setError('');
    try {
      await api(`/opportunities/${opportunityId}/customer-logo`, {
        method: 'PATCH',
        body: JSON.stringify({ customerLogo: value }),
      });
      await onChange();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const pick = (f: File | undefined) => {
    setError('');
    if (!f) return;
    if (!ACCEPTED.includes(f.type)) {
      setError('Use PNG, JPEG, GIF or WEBP. SVG is refused: it can carry script.');
      return;
    }
    if (f.size > MAX_LOGO_BYTES) {
      setError(`${Math.round(f.size / 1024)} kB is over the ${MAX_LOGO_BYTES / 1024} kB limit.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => send(String(reader.result));
    reader.readAsDataURL(f);
  };

  return (
    <p style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '10px 0 0' }}>
      {customerLogo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={customerLogo} alt={`${customerName} logo`} style={{ maxHeight: 32, maxWidth: 120 }} />
      )}
      {mayEdit && (
        <>
          <button className="ghost" disabled={busy} onClick={() => file.current?.click()}>
            {busy ? 'Saving…' : customerLogo ? 'Replace customer logo' : 'Add customer logo'}
          </button>
          {customerLogo && (
            <button className="ghost" disabled={busy} onClick={() => send('')}>
              Remove
            </button>
          )}
          <input
            ref={file}
            type="file"
            hidden
            accept="image/png,image/jpeg,image/gif,image/webp"
            onChange={(e) => pick(e.target.files?.[0])}
          />
        </>
      )}
      {error && <span className="error">{error}</span>}
    </p>
  );
}
