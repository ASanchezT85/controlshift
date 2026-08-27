'use client';

import { useMemo, useState } from 'react';

export interface Dependency {
  from: string;
  relation: string;
  to: string;
}

export interface FindingRef {
  id: string;
  title: string;
  state: string;
  source_entities: string[];
}

/**
 * Dependency graph (MASTER SPEC 22). Drawn as impact propagation, not as a
 * hairball: 488 edges rendered at once tell an engineer nothing, while
 * "this module carries 16 addresses read by 9 program files, and the scanner
 * behind it reaches a network we cannot enumerate" is the whole point.
 */
export default function DependencyCard({
  dependencies,
  findings,
}: {
  dependencies: Dependency[];
  findings: FindingRef[];
}) {
  const [selected, setSelected] = useState<string>('');

  const model = useMemo(() => {
    const addressesOf = new Map<string, Set<string>>(); // slot -> addresses
    const programsOf = new Map<string, Set<string>>(); // address -> programs
    const networks = new Map<string, { scannedBy: string[]; inventory: string[] }>();
    const messageTargets = new Map<string, string[]>(); // network -> MSG sites

    for (const d of dependencies) {
      if (d.relation === 'MAPS_TO_MODULE') {
        if (!addressesOf.has(d.to)) addressesOf.set(d.to, new Set());
        addressesOf.get(d.to)!.add(d.from);
      } else if (d.relation === 'READ_BY') {
        if (!programsOf.has(d.from)) programsOf.set(d.from, new Set());
        programsOf.get(d.from)!.add(d.to);
      } else if (d.relation === 'WRITES') {
        if (!programsOf.has(d.to)) programsOf.set(d.to, new Set());
        programsOf.get(d.to)!.add(d.from);
      } else if (d.relation === 'SCANS') {
        const n = networks.get(d.to) ?? { scannedBy: [], inventory: [] };
        n.scannedBy.push(d.from);
        networks.set(d.to, n);
      } else if (d.relation === 'NODE_INVENTORY') {
        const n = networks.get(d.from) ?? { scannedBy: [], inventory: [] };
        n.inventory.push(d.to);
        networks.set(d.from, n);
      } else if (d.relation === 'TARGETS_NETWORK') {
        messageTargets.set(d.to, [...(messageTargets.get(d.to) ?? []), d.from]);
      }
    }

    // A network that only MSG instructions reach is still a network, and an
    // undetermined one is the whole finding. Attaching those messages to
    // DeviceNet instead would be inventing a route nobody evidenced.
    for (const target of messageTargets.keys()) {
      if (!networks.has(target)) networks.set(target, { scannedBy: [], inventory: [] });
    }

    const modules = [...addressesOf.entries()]
      .map(([slot, addresses]) => {
        const programs = new Set<string>();
        for (const a of addresses) for (const p of programsOf.get(a) ?? []) programs.add(p);
        const [, num, catalog] = slot.split(':');
        return {
          id: slot,
          slot: Number(num),
          catalog,
          addresses: [...addresses].sort(),
          programs: [...programs].sort(),
        };
      })
      .sort((a, b) => a.slot - b.slot);

    return { modules, networks: [...networks.entries()], messageTargets };
  }, [dependencies]);

  const findingsFor = (entity: string) =>
    findings.filter((f) => f.source_entities.some((e) => e === entity || e.startsWith(entity)));

  const chosen = model.modules.find((m) => m.id === selected);
  const chosenNetwork = model.networks.find(([id]) => id === selected);

  return (
    <div className="card">
      <h2>
        Dependency graph
        <span style={{ float: 'right', textTransform: 'none', letterSpacing: 0, fontSize: 13 }}>
          {dependencies.length} reconstructed relationships
        </span>
      </h2>

      {model.networks.length > 0 && (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            How a network finding propagates. This is the chain that makes a scanner a project
            rather than a part.
          </p>
          <div className="scroll">
            <svg viewBox="0 0 760 200" width="100%" style={{ maxWidth: 760, display: 'block' }}>
              {model.networks.map(([network, n], i) => {
                const y = 40 + i * 70;
                const msgs = model.messageTargets.get(network) ?? [];
                const label = network.replace('network:', '');
                const unknown =
                  n.inventory.includes('UNDETERMINED') || network.endsWith('UNDETERMINED');
                return (
                  <g key={network}>
                    {n.scannedBy.map((s, j) => (
                      <g key={s}>
                        <rect
                          x={0}
                          y={y - 16 + j * 34}
                          width={168}
                          height={30}
                          rx={5}
                          className="node module"
                          onClick={() => setSelected(s)}
                        />
                        <text x={84} y={y + 3 + j * 34} className="nodetext">
                          {s.replace('slot:', 'slot ').replace(':', ' ')}
                        </text>
                      </g>
                    ))}
                    {n.scannedBy.length > 0 && (
                      <>
                        <line x1={168} y1={y} x2={236} y2={y} className="edge" markerEnd="url(#a)" />
                        <text x={202} y={y - 8} className="edgetext">
                          scans
                        </text>
                      </>
                    )}

                    <rect
                      x={236}
                      y={y - 16}
                      width={150}
                      height={30}
                      rx={5}
                      className={`node network${unknown ? ' unknown' : ''}`}
                      onClick={() => setSelected(network)}
                    />
                    <text x={311} y={y + 3} className="nodetext">
                      {label}
                    </text>

                    {n.inventory.length > 0 && (
                      <>
                        <line
                          x1={386}
                          y1={y}
                          x2={454}
                          y2={y}
                          className="edge"
                          markerEnd="url(#a)"
                        />
                        <text x={420} y={y - 8} className="edgetext">
                          nodes
                        </text>
                        <rect
                          x={454}
                          y={y - 16}
                          width={150}
                          height={30}
                          rx={5}
                          className={`node${unknown ? ' unknown' : ''}`}
                        />
                        <text x={529} y={y + 3} className="nodetext">
                          {n.inventory.join(', ')}
                        </text>
                      </>
                    )}

                    {msgs.length > 0 && (
                      <>
                        <line
                          x1={236}
                          y1={y + 22}
                          x2={280}
                          y2={y + 6}
                          className="edge"
                          markerEnd="url(#a)"
                        />
                        <text x={104} y={y + 28} className="edgetext">
                          {msgs.length} MSG instruction{msgs.length === 1 ? '' : 's'} target it
                        </text>
                      </>
                    )}
                  </g>
                );
              })}
              <defs>
                <marker id="a" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 z" className="arrow" />
                </marker>
              </defs>
            </svg>
          </div>
        </>
      )}

      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Slot</th>
              <th>Module</th>
              <th>Addresses</th>
              <th>Program files touching them</th>
              <th>Findings</th>
            </tr>
          </thead>
          <tbody>
            {model.modules.map((m) => (
              <tr
                key={m.id}
                onClick={() => setSelected(selected === m.id ? '' : m.id)}
                style={{ cursor: 'pointer' }}
              >
                <td>{m.slot}</td>
                <td>{m.catalog}</td>
                <td>{m.addresses.length}</td>
                <td>{m.programs.length}</td>
                <td className="muted">
                  {findingsFor(m.id)
                    .map((f) => f.id)
                    .join(', ') || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {chosen && (
        <div className="notice" style={{ borderLeftColor: 'var(--accent)' }}>
          <strong>
            slot {chosen.slot} — {chosen.catalog}
          </strong>
          <div style={{ fontSize: 13, marginTop: 6 }}>
            <div>
              <span className="muted">Addresses:</span> {chosen.addresses.slice(0, 24).join(', ')}
              {chosen.addresses.length > 24 ? ` … +${chosen.addresses.length - 24}` : ''}
            </div>
            <div>
              <span className="muted">Program files:</span> {chosen.programs.join(', ') || '—'}
            </div>
            <div>
              <span className="muted">Findings resting on it:</span>{' '}
              {findingsFor(chosen.id)
                .map((f) => `${f.id} (${f.state.replace(/_/g, ' ').toLowerCase()})`)
                .join(', ') || 'none'}
            </div>
          </div>
        </div>
      )}

      {chosenNetwork && (
        <div className="notice">
          <strong>{chosenNetwork[0]}</strong>
          <div style={{ fontSize: 13, marginTop: 6 }}>
            <div>
              <span className="muted">Scanned by:</span> {chosenNetwork[1].scannedBy.join(', ')}
            </div>
            <div>
              <span className="muted">Node inventory:</span>{' '}
              {chosenNetwork[1].inventory.join(', ')}
              {chosenNetwork[1].inventory.includes('UNDETERMINED') &&
                ' — the node list is not evidenced, so every node-level estimate is a guess'}
            </div>
            <div>
              <span className="muted">Findings resting on it:</span>{' '}
              {findingsFor(chosenNetwork[0])
                .map((f) => f.id)
                .join(', ') || 'none'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
