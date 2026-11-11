import type { ErrorResponse } from '../shared/api';

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? 'GET',
    headers: init?.body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: init?.body === undefined ? null : JSON.stringify(init.body),
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = isError(data) ? data.message : `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

const isError = (d: unknown): d is ErrorResponse =>
  typeof d === 'object' && d !== null && 'message' in d && typeof d.message === 'string';

export function compact(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '')}k`;
  return String(n);
}

export const full = (n: number) => n.toLocaleString();

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0] ?? 'th');
}

export function prettyDate(iso: string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { ...opts, timeZone: 'UTC' });
}

export function vibrate(pattern: number | number[] = 8) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // not supported
  }
}

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
