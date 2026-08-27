'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

export interface Branding {
  name: string;
  brandName: string | null;
  brandLogo: string | null;
  reportFooter: string | null;
  preparedByLine: string | null;
}

const MAX_LOGO_BYTES = 256 * 1024;
const ACCEPTED = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/**
 * Report branding (MASTER SPEC 39). What an integrator puts on every document
 * it sends to its customer.
 */
export default function BrandingCard({ role }: { role: string }) {
  const [branding, setBranding] = useState<Branding | null>(null);
  const [form, setForm] = useState({ brandName: '', reportFooter: '', preparedByLine: '' });
  const [logo, setLogo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const file = useRef<HTMLInputElement>(null);

  const mayEdit = role === 'ORG_ADMIN';

  useEffect(() => {
    api<Branding>('/organization/branding')
      .then((b) => {
        setBranding(b);
        setForm({
          brandName: b.brandName ?? '',
          reportFooter: b.reportFooter ?? '',
          preparedByLine: b.preparedByLine ?? '',
        });
        setLogo(b.brandLogo);
      })
      .catch((e) => setError(e.message));
  }, []);

  const pick = (f: File | undefined) => {
    setError('');
    if (!f) return;
    // SVG is refused by the API too: a logo lands in an <img> inside a document
    // that gets forwarded, and SVG can carry script.
    if (!ACCEPTED.includes(f.type)) {
      setError(`${f.type || 'that file'} is not accepted. Use PNG, JPEG, GIF or WEBP.`);
      return;
    }
    if (f.size > MAX_LOGO_BYTES) {
      setError(`${Math.round(f.size / 1024)} kB is over the ${MAX_LOGO_BYTES / 1024} kB limit.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogo(String(reader.result));
    reader.readAsDataURL(f);
  };

  const save = async () => {
    setBusy(true);
    setError('');
    setSaved('');
    try {
      const updated = await api<Branding>('/organization/branding', {
        method: 'PATCH',
        body: JSON.stringify({ ...form, brandLogo: logo ?? '' }),
      });
      setBranding(updated);
      setSaved('Branding updated. New reports carry it; documents already generated do not change.');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!branding) {
    return (
      <div className="card">
        <h2>Report branding</h2>
        {error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Report branding</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Every deliverable is written for B2B2B delivery: your identity on the cover, your customer’s
        name from the opportunity. Reports already generated are immutable and keep the branding
        they were made with.
      </p>
      {error && <p className="error">{error}</p>}

      <div className="scroll">
        <table>
          <tbody>
            <tr>
              <td style={{ width: 210 }}>Organization name</td>
              <td>
                <input
                  value={form.brandName}
                  disabled={!mayEdit}
                  placeholder={branding.name}
                  onChange={(e) => setForm({ ...form, brandName: e.target.value })}
                />
              </td>
            </tr>
            <tr>
              <td>Prepared-by line</td>
              <td>
                <input
                  value={form.preparedByLine}
                  disabled={!mayEdit}
                  placeholder="e.g. Controls Engineering, P.Eng. 12345"
                  onChange={(e) => setForm({ ...form, preparedByLine: e.target.value })}
                />
                <div className="muted" style={{ fontSize: 12 }}>
                  Sits under the preparer’s name. The preparer is whoever generates the document.
                </div>
              </td>
            </tr>
            <tr>
              <td>Report footer</td>
              <td>
                <input
                  value={form.reportFooter}
                  disabled={!mayEdit}
                  placeholder="e.g. preflight assessment - not for construction"
                  onChange={(e) => setForm({ ...form, reportFooter: e.target.value })}
                />
              </td>
            </tr>
            <tr>
              <td>Organization logo</td>
              <td>
                {logo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logo}
                    alt="organization logo"
                    style={{ maxHeight: 56, maxWidth: 200, display: 'block', marginBottom: 8 }}
                  />
                )}
                {mayEdit && (
                  <>
                    <button className="ghost" onClick={() => file.current?.click()}>
                      {logo ? 'Replace' : 'Choose image'}
                    </button>{' '}
                    {logo && (
                      <button className="ghost" onClick={() => setLogo(null)}>
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
                <div className="muted" style={{ fontSize: 12 }}>
                  PNG, JPEG, GIF or WEBP, up to {MAX_LOGO_BYTES / 1024} kB. SVG is refused: it can
                  carry script into a document that gets forwarded.
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {mayEdit ? (
        <p style={{ marginBottom: 0 }}>
          <button disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Save branding'}
          </button>{' '}
          {saved && <span className="muted">{saved}</span>}
        </p>
      ) : (
        <p className="muted" style={{ marginBottom: 0 }}>
          Read-only for your role. The organization’s identity is an admin’s call.
        </p>
      )}
    </div>
  );
}
