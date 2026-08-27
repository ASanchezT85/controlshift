'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, sessionUser } from '@/lib/api';
import BrandingCard from './BrandingCard';

interface Template {
  id: string;
  workPackageCode: string;
  unitType: string;
  role: string;
  minHoursPerUnit: number;
  maxHoursPerUnit: number;
  complexityFactor: number;
}

/**
 * Organization administration (MASTER SPEC 39/52) — report branding and the
 * organization's own effort templates. ControlShift ships starter numbers and
 * claims no universal engineering-hour values; this is where an integrator
 * replaces them with its own.
 */
export default function AdminPage() {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [edited, setEdited] = useState<Record<string, Partial<Template>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const role = sessionUser()?.role ?? 'VIEWER';
  const mayEdit = role === 'ESTIMATOR' || role === 'ORG_ADMIN';

  const load = useCallback(async () => {
    setError('');
    try {
      setTemplates(await api<Template[]>('/effort-templates'));
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    if (!sessionUser()) {
      setError('Sign in first.');
      return;
    }
    load();
  }, [load]);

  const change = (t: Template, field: keyof Template, value: string) => {
    const key = `${t.workPackageCode}|${t.unitType}`;
    setEdited({ ...edited, [key]: { ...edited[key], [field]: Number(value) } });
  };

  const save = async () => {
    if (!templates) return;
    setBusy(true);
    setError('');
    setSaved('');
    try {
      const rows = templates
        .filter((t) => edited[`${t.workPackageCode}|${t.unitType}`])
        .map((t) => {
          const patch = edited[`${t.workPackageCode}|${t.unitType}`];
          return {
            workPackageCode: t.workPackageCode,
            unitType: t.unitType,
            role: t.role,
            minHoursPerUnit: patch.minHoursPerUnit ?? t.minHoursPerUnit,
            maxHoursPerUnit: patch.maxHoursPerUnit ?? t.maxHoursPerUnit,
            complexityFactor: patch.complexityFactor ?? t.complexityFactor,
          };
        });
      if (rows.length === 0) return;
      await api('/effort-templates', { method: 'PUT', body: JSON.stringify({ templates: rows }) });
      setEdited({});
      setSaved(`${rows.length} template${rows.length === 1 ? '' : 's'} updated`);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const dirty = Object.keys(edited).length;

  return (
    <>
      <div className="card">
        <h2>
          Administration
          <span style={{ float: 'right', textTransform: 'none', letterSpacing: 0 }}>
            <Link href="/">All opportunities</Link>
          </span>
        </h2>
        {error && <p className="error">{error}</p>}
        <p className="muted" style={{ marginTop: 0 }}>
          Signed in as {role.replace(/_/g, ' ').toLowerCase()}.{' '}
          {mayEdit
            ? 'You can change this organization’s rates.'
            : 'Rates are read-only for your role; an estimator or admin owns them.'}
        </p>
      </div>

      <BrandingCard role={role} />

      <div className="card">
        <h2>Effort templates</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          One rate per work package <em>and unit</em>. A package with no template is reported NOT
          PRICED and excluded from the range — it is never valued at zero.
        </p>
        {!templates && !error && <p className="muted">Loading…</p>}
        {templates && (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Work package</th>
                  <th>Unit</th>
                  <th>Role</th>
                  <th>Min h / unit</th>
                  <th>Max h / unit</th>
                  <th>Complexity</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id}>
                    <td>{t.workPackageCode.replace(/_/g, ' ')}</td>
                    <td className="muted">{t.unitType.toLowerCase()}</td>
                    <td className="muted">{t.role.replace(/_/g, ' ').toLowerCase()}</td>
                    <td>
                      <input
                        style={{ width: 90 }}
                        defaultValue={t.minHoursPerUnit}
                        disabled={!mayEdit}
                        onChange={(e) => change(t, 'minHoursPerUnit', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        style={{ width: 90 }}
                        defaultValue={t.maxHoursPerUnit}
                        disabled={!mayEdit}
                        onChange={(e) => change(t, 'maxHoursPerUnit', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        style={{ width: 90 }}
                        defaultValue={t.complexityFactor}
                        disabled={!mayEdit}
                        onChange={(e) => change(t, 'complexityFactor', e.target.value)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {mayEdit && (
          <p style={{ marginBottom: 0 }}>
            <button disabled={busy || dirty === 0} onClick={save}>
              {busy ? 'Saving…' : dirty ? `Save ${dirty} change${dirty === 1 ? '' : 's'}` : 'Save'}
            </button>{' '}
            {saved && <span className="muted">{saved}</span>}
          </p>
        )}
      </div>
    </>
  );
}
