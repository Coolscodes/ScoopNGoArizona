// Workstream 6, Weekly invoice generator (cron).
// PORT of the repo-root /api/auto-invoice.js, preserving its tested behavior:
//   - Monday to Sunday week; period_start = Monday, period_end = Sunday.
//   - Idempotent: skip any customer who already has an invoice for this week's
//     period_start (any status).
//   - Skip customers with no price_per_visit.
//   - Due date = the customer's service day this week, or Friday if none,
//     clamped to within the week.
//   - Creates a 'sent' invoice noted "Week of <label> - <service_type|Visit>".
//
// Auth & scope (per WS6 conventions):
//   - CRON_SECRET only (Bearer or x-cron-secret); fail closed if unset. The old
//     ADMIN_PASSWORD path is dropped, staff trigger this from the authed app.
//   - Default (cron) scope: only active customers whose preferred_day is today
//     (matches the original cron behavior).
//   - Pass ?scope=all to invoice ALL active customers (the original's manual
//     "admin" behavior). GET and POST are both accepted; Vercel cron uses GET.

import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import type { Customer } from '@/lib/types';

export const dynamic = 'force-dynamic';

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed if unset
  const auth = request.headers.get('authorization');
  const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : '';
  const header = request.headers.get('x-cron-secret') || '';
  const url = new URL(request.url);
  const query = url.searchParams.get('secret') || '';
  return bearer === secret || header === secret || query === secret;
}

interface GenResult {
  name: string;
  amount?: number;
  status: string;
}

async function generate(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = supabaseServer();

  // Monday of the current week as period_start (invoices are per-week).
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 1=Mon...
  const diffToMon = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMon);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const periodStart = fmt(monday);
  const periodEnd = fmt(sunday);

  const fmtLabel = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const weekLabel = `${fmtLabel(monday)} to ${fmtLabel(sunday)}, ${monday.getFullYear()}`;

  const url = new URL(request.url);
  const scopeAll = url.searchParams.get('scope') === 'all';
  const todayName = now.toLocaleDateString('en-US', { weekday: 'long' });

  // Cron scope: only customers whose service day matches today.
  // scope=all: every active customer (the original manual path).
  let custQuery = sb
    .from('customers')
    .select('*')
    .eq('active', true)
    .order('first_name', { ascending: true });
  if (!scopeAll) custQuery = custQuery.eq('preferred_day', todayName);

  const { data: custData } = await custQuery;
  const customers = (custData ?? []) as Customer[];

  if (!customers.length) {
    return NextResponse.json({ message: 'No active customers found', week: weekLabel });
  }

  // Which customers already have an invoice for this week (idempotency).
  const { data: existing } = await sb
    .from('invoices')
    .select('customer_id')
    .eq('period_start', periodStart);
  const existingIds = new Set(
    ((existing ?? []) as { customer_id: string }[]).map((i) => i.customer_id)
  );

  const dayMap: Record<string, number> = {
    Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
  };

  const results: GenResult[] = [];

  for (const c of customers) {
    const name = `${c.first_name} ${c.last_name}`.trim();

    if (existingIds.has(c.id)) {
      results.push({ name, status: 'skipped (already invoiced this week)' });
      continue;
    }
    if (!c.price_per_visit) {
      results.push({ name, status: 'skipped (no price set)' });
      continue;
    }

    // Due date = their service day this week, or Friday if none set.
    const serviceDayNum = (c.preferred_day ? dayMap[c.preferred_day] : undefined) ?? 5;
    const dueDate = new Date(monday);
    dueDate.setDate(monday.getDate() + ((serviceDayNum - 1 + 7) % 7));
    const dueDateStr = fmt(dueDate <= sunday ? dueDate : sunday);

    const { error } = await sb.from('invoices').insert({
      customer_id: c.id,
      amount: c.price_per_visit,
      status: 'sent',
      due_date: dueDateStr,
      period_start: periodStart,
      period_end: periodEnd,
      notes: `Week of ${weekLabel} - ${c.service_type || 'Visit'}`,
    });

    results.push({
      name,
      amount: c.price_per_visit,
      status: error ? `error ${error.message}` : 'created',
    });
  }

  const created = results.filter((r) => r.status === 'created').length;
  const skipped = results.filter((r) => r.status.startsWith('skipped')).length;

  return NextResponse.json({ week: weekLabel, created, skipped, results });
}

export async function GET(request: Request) {
  return generate(request);
}

export async function POST(request: Request) {
  return generate(request);
}
