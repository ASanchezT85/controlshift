'use client';

const BASE = process.env.NEXT_PUBLIC_API ?? 'http://127.0.0.1:3000/api';
const TOKEN_KEY = 'controlshift.token';
const USER_KEY = 'controlshift.user';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

export function token(): string | null {
  return typeof window === 'undefined' ? null : localStorage.getItem(TOKEN_KEY);
}

export function sessionUser(): SessionUser | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(USER_KEY);
  return raw ? (JSON.parse(raw) as SessionUser) : null;
}

export function signOut() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export async function login(email: string, password: string) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error('Invalid credentials');
  const data = await res.json();
  localStorage.setItem(TOKEN_KEY, data.accessToken);
  localStorage.setItem(USER_KEY, JSON.stringify(data.user));
  return data.user as SessionUser;
}

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(token() ? { authorization: `Bearer ${token()}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401) {
    signOut();
    throw new Error('Session expired');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `Request failed (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export interface UploadedArtifact {
  id: string;
  originalFilename: string;
  artifactType: string;
  size: number;
  sha256: string;
  processingStatus: string;
}

/// One file per request: the API accepts a single file per upload so a failure
/// is attributable to a file, not to a batch.
export async function uploadArtifact(
  opportunityId: string,
  file: File,
  artifactType?: string,
): Promise<UploadedArtifact> {
  const form = new FormData();
  // The declared type must precede the file: the server reads fields that
  // arrive before the file part.
  if (artifactType) form.append('artifactType', artifactType);
  form.append('file', file, file.name);

  const res = await fetch(`${BASE}/opportunities/${opportunityId}/artifacts`, {
    method: 'POST',
    // No content-type header: the browser sets the multipart boundary.
    headers: token() ? { authorization: `Bearer ${token()}` } : {},
    body: form,
  });
  if (res.status === 401) {
    signOut();
    throw new Error('Session expired');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as any);
    throw new Error(body.message ?? `Upload failed (${res.status})`);
  }
  return (await res.json()) as UploadedArtifact;
}
