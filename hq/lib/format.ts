// Formatting helpers. Owned by Workstream 0.

import { format, parseISO, startOfWeek, endOfWeek, isToday as dfIsToday } from 'date-fns';

export function money(amount?: number | null): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount ?? 0);
}

export function shortDate(date?: string | Date | null): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? parseISO(date) : date;
  return format(d, 'MMM d, yyyy');
}

export function dayMonth(date?: string | Date | null): string {
  if (!date) return '—';
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
  const d = typeof date === 'string' ? parseISO(date) : date;
  return dfIsToday(d);
}

// Monday-Sunday week bounds as YYYY-MM-DD strings (matches the existing charge flow).
export function weekBounds(ref: Date = new Date()): { start: string; end: string } {
  return {
    start: format(startOfWeek(ref, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
    end: format(endOfWeek(ref, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
  };
}

export function todayISO(): string {
  return format(new Date(), 'yyyy-MM-dd');
}
