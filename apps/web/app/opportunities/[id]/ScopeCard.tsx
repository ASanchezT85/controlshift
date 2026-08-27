'use client';

import { Fragment, useState } from 'react';

export interface WorkPackage {
  code: string;
  section: string;
  unit_type: string;
  quantity: number;
  triggered_by: string[];
}

export interface ScopeFinding {
  id: string;
  rule_id: string;
  title: string;
  state: string;
  evidence: { source_type: string; publication_id?: string; locator?: string }[];
}

/// MASTER SPEC 28 order. Sections with nothing in them are still listed: an
/// empty HMI section is a statement, and leaving it out would read as an
/// oversight rather than as a decision.
const SECTIONS = [
  'Discovery',
  'Controls Design',
  'PLC Software',
  'Networks',
  'HMI',
  'Drives',
  'Panel',
  'Testing',
  'Site',
  'Documentation',
  'Project Management',
];

export default function ScopeCard({
  workPackages,
  findings,
}: {
  workPackages: WorkPackage[];
  findings: ScopeFinding[];
}) {
  const [open, setOpen] = useState<string>('');
  const byId = new Map(findings.map((f) => [f.id, f]));

  const grouped = SECTIONS.map((section) => ({
    section,
    items: workPackages.filter((w) => w.section === section),
  }));
  const unassigned = workPackages.filter((w) => !SECTIONS.includes(w.section));

  return (
    <div className="card">
      <h2>
        Engineering scope
        <span style={{ float: 'right', textTransform: 'none', letterSpacing: 0, fontSize: 13 }}>
          {workPackages.length} work packages
        </span>
      </h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Every line answers <em>why is this in scope?</em> — select one to see the chain back to the
        finding, the rule and the evidence it rests on.
      </p>

      <div className="scroll">
        <table>
          <tbody>
            {grouped.map(({ section, items }) => (
              // The key belongs on the fragment: React cannot tell the rows of
              // one section from another's without it, and may drop rows.
              <Fragment key={section}>
                <tr>
                  <td colSpan={4} style={{ paddingTop: 14 }}>
                    <strong>{section}</strong>{' '}
                    {items.length === 0 && (
                      <span className="muted" style={{ fontSize: 13 }}>
                        — nothing scoped here
                      </span>
                    )}
                  </td>
                </tr>
                {items.map((w) => {
                  const key = `${w.code}|${w.unit_type}`;
                  return (
                    <tr
                      key={key}
                      onClick={() => setOpen(open === key ? '' : key)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td style={{ paddingLeft: 24 }}>{w.code.replace(/_/g, ' ').toLowerCase()}</td>
                      <td style={{ width: 70 }}>{w.quantity}</td>
                      <td className="muted" style={{ width: 110 }}>
                        {w.unit_type.toLowerCase()}
                      </td>
                      <td className="muted" style={{ fontSize: 13 }}>
                        {open === key ? (
                          <div className="trace">
                            {w.triggered_by.map((id) => {
                              const f = byId.get(id);
                              if (!f) return <div key={id}>{id}</div>;
                              const evidence = f.evidence
                                .map((e) => e.publication_id ?? e.locator ?? e.source_type)
                                .join('; ');
                              return (
                                <div key={id} style={{ marginBottom: 4 }}>
                                  <span className={`state ${f.state}`}>{f.id}</span> {f.title}
                                  <div>
                                    ← {f.rule_id} ← {evidence}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          w.triggered_by.join(', ')
                        )}
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
            {unassigned.length > 0 && (
              <tr>
                <td colSpan={4} className="error">
                  {unassigned.length} work package(s) have no section and would be missing from the
                  proposal: {unassigned.map((w) => w.code).join(', ')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
        Scope is derived, not typed. To take something out, record an exclusion — an approved one
        removes it from the proposal and says who decided and why.
      </p>
    </div>
  );
}
