'use client';

import { useMemo, useState } from 'react';

export interface Operand {
  raw: string;
  file: string | null;
  indirect: boolean;
  immediate: boolean;
}

export interface Instruction {
  source_opcode: string;
  semantic_opcode: string;
  operands: Operand[];
}

export interface Rung {
  index: number;
  instructions: Instruction[];
  has_branch: boolean;
  /// Absent on assessments produced before IR 1.1.0. A stored analysis is
  /// never rewritten, so old ones stay readable and this stays optional.
  source_text?: string;
  source_span: { artifact: string; line: number };
}

export interface Program {
  number: number;
  name: string;
  rungs: Rung[];
}

export interface ExplorerFinding {
  id: string;
  state: string;
  source_entities: string[];
}

/// The constructs a finding rests on. Highlighting them is the difference
/// between browsing 684 rungs and finding the two that block a migration.
const NOTABLE: Record<string, string> = {
  IIM: 'no equivalent in the target I/O model',
  IOM: 'no equivalent in the target I/O model',
  PID: 'gain form and scaling change',
  MSG: 'must be re-targeted',
};

const PAGE = 60;

export default function SystemExplorer({
  programs,
  findings,
  sti,
}: {
  programs: Program[];
  findings: ExplorerFinding[];
  sti: { program_file: number; interval_ms: number } | null | undefined;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [filter, setFilter] = useState('');
  const [shown, setShown] = useState(PAGE);

  // Findings name their sites as LAD<file>:rung<index>, so the same string
  // that drives the scope trace drives this.
  const findingsByProgram = useMemo(() => {
    const map = new Map<number, Set<string>>();
    for (const f of findings) {
      for (const e of f.source_entities) {
        const m = /^LAD(\d+)/.exec(e);
        if (!m) continue;
        const n = Number(m[1]);
        if (!map.has(n)) map.set(n, new Set());
        map.get(n)!.add(f.id);
      }
    }
    return map;
  }, [findings]);

  const findingsByRung = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const f of findings) {
      for (const e of f.source_entities) {
        const m = /^LAD(\d+):rung(\d+)/.exec(e);
        if (!m) continue;
        const key = `${m[1]}:${m[2]}`;
        if (!map.has(key)) map.set(key, new Set());
        map.get(key)!.add(f.id);
      }
    }
    return map;
  }, [findings]);

  const program = programs.find((p) => p.number === selected) ?? null;
  // One check for the whole card rather than a fallback per rung.
  const hasSourceText = programs.some((p) => p.rungs.some((r) => r.source_text !== undefined));
  const needle = filter.trim().toUpperCase();
  const rungs = useMemo(() => {
    if (!program) return [];
    if (!needle) return program.rungs;
    return program.rungs.filter((r) => (r.source_text ?? '').toUpperCase().includes(needle));
  }, [program, needle]);

  return (
    <div className="card">
      <h2>
        System explorer
        <span style={{ float: 'right', textTransform: 'none', letterSpacing: 0, fontSize: 13 }}>
          {programs.length} program files ·{' '}
          {programs.reduce((n, p) => n + p.rungs.length, 0)} rungs
        </span>
      </h2>

      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>File</th>
              <th>Name</th>
              <th>Rungs</th>
              <th>Instructions</th>
              <th>Findings</th>
            </tr>
          </thead>
          <tbody>
            {programs.map((p) => {
              const instructions = p.rungs.reduce((n, r) => n + r.instructions.length, 0);
              const ids = [...(findingsByProgram.get(p.number) ?? [])];
              return (
                <tr
                  key={p.number}
                  onClick={() => {
                    setSelected(selected === p.number ? null : p.number);
                    setShown(PAGE);
                    setFilter('');
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <td>
                    LAD{p.number}
                    {sti?.program_file === p.number && (
                      <div className="state UNKNOWN" style={{ fontSize: 11 }}>
                        STI {sti.interval_ms} ms
                      </div>
                    )}
                  </td>
                  <td>{p.name}</td>
                  <td>{p.rungs.length}</td>
                  <td className="muted">{instructions}</td>
                  <td className="muted">{ids.join(', ') || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {program && (
        <>
          <div className="inline-form">
            <input
              placeholder={`Filter the ${program.rungs.length} rungs of ${program.name} — try IIM, PID, or an address`}
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setShown(PAGE);
              }}
            />
          </div>

          <p className="muted" style={{ fontSize: 13 }}>
            {rungs.length} rung{rungs.length === 1 ? '' : 's'}
            {needle ? ` matching “${filter}”` : ''} in LAD{program.number} {program.name}.
            {hasSourceText
              ? ' Lines are shown exactly as they appear in the artifact — nothing is reconstructed, so a branch reads as a branch.'
              : ' This assessment predates rung capture, so lines are REBUILT from the instruction list: branch structure is not shown and a parallel branch reads as a series. Re-analyze to see the source.'}
          </p>

          <div className="scroll">
            <table>
              <tbody>
                {rungs.slice(0, shown).map((r) => {
                  const ids = [...(findingsByRung.get(`${program.number}:${r.index}`) ?? [])];
                  const notable = r.instructions
                    .map((i) => i.source_opcode)
                    .filter((op) => NOTABLE[op]);
                  return (
                    <tr key={r.index}>
                      <td className="muted" style={{ width: 96, whiteSpace: 'nowrap' }}>
                        rung {r.index}
                        <div style={{ fontSize: 11 }}>line {r.source_span.line}</div>
                      </td>
                      <td>
                        <code className="rung">
                          {r.source_text ??
                            `SOR ${r.instructions
                              .map((i) => [i.source_opcode, ...i.operands.map((o) => o.raw)].join(' '))
                              .join(' ')} EOR`}
                        </code>
                        {(notable.length > 0 || ids.length > 0) && (
                          <div style={{ fontSize: 12, marginTop: 3 }}>
                            {[...new Set(notable)].map((op) => (
                              <span key={op} className="state BLOCKED" style={{ marginRight: 10 }}>
                                {op} — {NOTABLE[op]}
                              </span>
                            ))}
                            {ids.length > 0 && <span className="muted">{ids.join(', ')}</span>}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {rungs.length > shown && (
            <p>
              <button className="ghost" onClick={() => setShown(shown + PAGE * 4)}>
                Show {Math.min(PAGE * 4, rungs.length - shown)} more of {rungs.length}
              </button>
            </p>
          )}
        </>
      )}
    </div>
  );
}
