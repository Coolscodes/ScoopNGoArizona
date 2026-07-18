// Formatting helpers. Owned by Workstream 0.

import { format, parseISO, isToday as dfIsToday } from 'date-fns';

// The business runs in Arizona; the servers run in UTC. Every "what day is it"
// question must be answered in Phoenix time or evening work (after 5pm MST =
// midnight UTC) lands on the wrong day/week.
export const BUSINESS_TZ = 'America/Phoenix';

export function money(amount?: number | null): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount ?? 0);
}

export function shortDate(date?: string | Date | null): string {
  if (!date) return '·';
  const d = typeof date === 'string' ? parseISO(date) : date;
  return format(d, 'MMM d, yyyy');
}

export function dayMonth(date?: string | Date | null): string {
  if (!date) return '·';
  const d = typeof date === 'string' ? parseISO(date) : date;
  return format(d, 'EEE, MMM d');
}

export function timeOfDay(date?: string | Date | null): string {
  if (!date) return '';
  const d = typeof date === 'string' ? parseISO(date) : date;
  return format(d, 'h:mma').toLowerCase();
}

export function phone(raw?: string | null): string {
  if (!raw) return '';
  const d = raw.replace(/\D/g, '');
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return raw;
}

export function fullName(p?: { first_name?: string; last_name?: string } | null): string {
  if (!p) return '';
  return `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();
}

export function initials(p?: { first_name?: string; last_name?: string } | null): string {
  if (!p) return '?';
  return `${(p.first_name ?? '?')[0] ?? ''}${(p.last_name ?? '')[0] ?? ''}`.toUpperCase();
}

export function isToday(date?: string | Date | null): boolean {
  if (!date) return false;
  // Date-only strings compare against the Phoenix calendar day, not server-local.
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return date === todayISO();
  }
  const d = typeof date === 'string' ? parseISO(date) : date;
  return dfIsToday(d);
}

// Monday-Sunday week bounds as YYYY-MM-DD strings (matches the charge flow),
// computed on the Phoenix calendar.
export function weekBounds(ref?: Date): { start: string; end: string } {
  const dayStr = ref
    ? ref.toLocaleDateString('en-CA', { timeZone: BUSINESS_TZ })
    : todayISO();
  const d = new Date(dayStr + 'T00:00:00Z');
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
  const start = d.toISOString().slice(0, 10);
  d.setUTCDate(d.getUTCDate() + 6);
  return { start, end: d.toISOString().slice(0, 10) };
}

// Today's date in Phoenix, as YYYY-MM-DD (en-CA formats as ISO).
export function todayISO(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: BUSINESS_TZ });
}
