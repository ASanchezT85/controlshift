'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, login, sessionUser, signOut, type SessionUser } from '@/lib/api';

interface OpportunityRow {
  id: string;
  name: string;
  customerName: string;
  facilityName: string;
  proposalType: string;
  status: string;
  shutdownRequirementHours: number | null;
  _count: { artifacts: number; analyses: number };
}

export default function Home() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [rows, setRows] = useState<OpportunityRow[] | null>(null);
  const [error, setError] = useState<string>('');
  const [email, setEmail] = useState('engineer@northstar-integrators.test');
  const [password, setPassword] = useState('');

  useEffect(() => {
    setUser(sessionUser());
  }, []);

  useEffect(() => {
    if (!user) return;
    api<OpportunityRow[]>('/opportunities')
      .then(setRows)
      .catch((e) => setError(e.message));
  }, [user]);

  if (!user) {
    return (
      <div className="card">
        <h2>Sign in</h2>
        <form
          className="login"
          onSubmit={async (e) => {
            e.preventDefault();
            setError('');
            try {
              setUser(await login(email, password));
            } catch (err: any) {
              setError(err.message);
            }
          }}
        >
          <label>
            <span className="muted">Email</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
          </label>
          <label>
            <span className="muted">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          <button type="submit">Sign in</button>
          {error && <p className="error">{error}</p>}
        </form>
      </div>
    );
  }

  return (
    <>
      <div className="card">
        <h2>
          Migration opportunities
          <span style={{ float: 'right', textTransform: 'none', letterSpacing: 0 }}>
            <span className="muted">
              {user.name} · {user.role.replace(/_/g, ' ').toLowerCase()}{' '}
            </span>
            <button
              className="ghost"
              onClick={() => {
                signOut();
                setUser(null);
                setRows(null);
              }}
            >
              Sign out
            </button>
          </span>
        </h2>
        {error && <p className="error">{error}</p>}
        {!rows && !error && <p className="muted">Loading…</p>}
        {rows && rows.length === 0 && <p className="muted">No opportunities yet.</p>}
        {rows && rows.length > 0 && (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Opportunity</th>
                  <th>Customer</th>
                  <th>Facility</th>
                  <th>Proposal</th>
                  <th>Shutdown</th>
                  <th>Artifacts</th>
                  <th>Analyses</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/opportunities/${o.id}`}>{o.name}</Link>
                    </td>
                    <td>{o.customerName}</td>
                    <td>{o.facilityName}</td>
                    <td>{o.proposalType.replace(/_/g, ' ')}</td>
                    <td>{o.shutdownRequirementHours ? `${o.shutdownRequirementHours} h` : '—'}</td>
                    <td>{o._count.artifacts}</td>
                    <td>{o._count.analyses}</td>
                    <td className="muted">{o.status.replace(/_/g, ' ').toLowerCase()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
