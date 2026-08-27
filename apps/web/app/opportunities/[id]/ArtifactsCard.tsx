'use client';

import { useRef, useState } from 'react';
import { uploadArtifact } from '@/lib/api';

export interface ArtifactRow {
  id: string;
  originalFilename: string;
  artifactType: string;
  size: number;
  processingStatus: string;
}

const TYPES = [
  ['', 'Detect from file extension'],
  ['PLC_SOURCE', 'PLC source'],
  ['SYMBOL_DATABASE', 'Symbol database'],
  ['IO_LIST', 'I/O list'],
  ['ELECTRICAL_DRAWING', 'Electrical drawing'],
  ['NETWORK_DRAWING', 'Network drawing'],
  ['HMI_PROJECT', 'HMI project'],
  ['DRIVE_BACKUP', 'Drive backup'],
  ['CUSTOMER_NOTE', 'Customer note'],
  ['PHOTO', 'Photo'],
] as const;

const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} kB`;

interface Progress {
  name: string;
  state: 'uploading' | 'done' | 'error' | 'duplicate';
  message?: string;
}

export default function ArtifactsCard({
  opportunityId,
  artifacts,
  onChange,
}: {
  opportunityId: string;
  artifacts: ArtifactRow[];
  onChange: () => Promise<void> | void;
}) {
  const [declaredType, setDeclaredType] = useState('');
  const [progress, setProgress] = useState<Progress[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // The extension only suggests a type. A PDF is an electrical drawing or a
  // network sketch depending on what it actually is, and only a person knows.
  const send = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    const known = new Set(artifacts.map((a) => `${a.originalFilename}|${a.size}`));
    setProgress(files.map((f) => ({ name: f.name, state: 'uploading' })));

    for (const [i, file] of files.entries()) {
      try {
        const saved = await uploadArtifact(opportunityId, file, declaredType || undefined);
        const wasKnown = known.has(`${saved.originalFilename}|${saved.size}`);
        setProgress((p) =>
          p.map((row, j) =>
            j === i
              ? {
                  ...row,
                  state: wasKnown ? 'duplicate' : 'done',
                  message: wasKnown
                    ? 'identical bytes already stored — kept the original'
                    : saved.artifactType.replace(/_/g, ' ').toLowerCase(),
                }
              : row,
          ),
        );
      } catch (e: any) {
        setProgress((p) =>
          p.map((row, j) => (j === i ? { ...row, state: 'error', message: e.message } : row)),
        );
      }
    }

    setBusy(false);
    if (input.current) input.current.value = '';
    await onChange();
  };

  const unscanned = artifacts.filter((a) => a.processingStatus === 'RECEIVED');

  return (
    <div className="card">
      <h2>Artifacts ({artifacts.length})</h2>

      <div
        className={`dropzone${dragging ? ' dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          send([...e.dataTransfer.files]);
        }}
      >
        <p style={{ margin: '0 0 10px' }}>
          Drop files here, or{' '}
          <button className="ghost" disabled={busy} onClick={() => input.current?.click()}>
            choose files
          </button>
        </p>
        <label className="muted" style={{ fontSize: 13 }}>
          Classify as{' '}
          <select value={declaredType} onChange={(e) => setDeclaredType(e.target.value)}>
            {TYPES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          onChange={(e) => send([...(e.target.files ?? [])])}
        />
        <p className="muted" style={{ fontSize: 12, margin: '10px 0 0' }}>
          Accepted: .SLC, .csv, .xlsx, .pdf, .txt, .jpg, .png. Archives and executables are
          refused — nothing is unpacked, so nothing is trusted.
        </p>
      </div>

      {progress.length > 0 && (
        <ul style={{ fontSize: 13, paddingLeft: 18 }}>
          {progress.map((p) => (
            <li key={p.name} className={p.state === 'error' ? 'error' : 'muted'}>
              <strong>{p.name}</strong>
              {p.state === 'uploading' && ' — uploading…'}
              {p.state === 'done' && ` — stored as ${p.message}`}
              {p.state === 'duplicate' && ` — ${p.message}`}
              {p.state === 'error' && ` — ${p.message}`}
            </li>
          ))}
        </ul>
      )}

      {unscanned.length > 0 && (
        <p className="notice">
          {unscanned.length} artifact{unscanned.length > 1 ? 's have' : ' has'} not cleared malware
          scanning. Analysis will refuse to consume {unscanned.length > 1 ? 'them' : 'it'} until a
          scanner marks {unscanned.length > 1 ? 'them' : 'it'} clean.
        </p>
      )}

      {artifacts.length > 0 && (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>File</th>
                <th>Classified as</th>
                <th>Size</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {artifacts.map((a) => (
                <tr key={a.id}>
                  <td>{a.originalFilename}</td>
                  <td className="muted">{a.artifactType.replace(/_/g, ' ').toLowerCase()}</td>
                  <td className="muted">{kb(a.size)}</td>
                  <td>
                    <span className={`state ${a.processingStatus === 'SCANNED' ? 'PASS' : 'UNKNOWN'}`}>
                      {a.processingStatus === 'SCANNED' ? 'READY' : 'AWAITING SCAN'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
