// Workstream 6, Weekly invoice generator (cron).
//   - Monday to Sunday week (Phoenix calendar); period_start = Monday.
//   - Only invoices clients who actually have a visit this week: an appointment
//     inside the week in 'scheduled' or 'completed' status. This keeps bi-weekly
//     and monthly clients (frequency_weeks > 1) from being billed on their off
//     weeks, and skipped visits are never billed.
//   - Idempotent: skip any customer who already has an invoice for this week's
//     period_start (any status).
//   - Skip customers with no price_per_visit.
//   - Due date = the customer's service day this week, or Friday if none,
//     clamped to within the week.
//   - Creates a 'sent' invoice noted "Week of <label> - <service_type|Visit>".
//
// Auth & scope:
//   - CRON_SECRET only (Bearer or x-cron-secret); fail closed if unset.
//   - Default (cron) scope: only active customers whose preferred_day is today
//     (Phoenix). Pass ?scope=all to consider ALL active customers.
//   GET and POST are both accepted; the daily cron orchestrator uses POST.

import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { currentWeek, dueDateFor } from '@/lib/charge-core';
import { BUSINESS_TZ } from '@/lib/format';
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
  const week = currentWeek();

  const url = new URL(request.url);
  const scopeAll = url.searchParams.get('scope') === 'all';
  const todayName = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    timeZone: BUSINESS_TZ,
  });

  // Cron scope: only customers whose service day matches today (Phoenix).
  // scope=all: every active customer.
  let custQuery = sb
    .from('customers')
    .select('*')
    .eq('active', true)
    .order('first_name', { ascending: true });
  if (!scopeAll) custQuery = custQuery.eq('preferred_day', todayName);

  const { data: custData } = await custQuery;
  const customers = (custData ?? []) as Customer[];

  if (!customers.length) {
    return NextResponse.json({ message: 'No active customers found', week: week.weekLabel });
  }

  // Which customers already have an invoice for this week (idempotency).
  const { data: existing } = await sb
    .from('invoices')
    .select('customer_id')
    .eq('period_start', week.periodStart);
  const existingIds = new Set(
    ((existing ?? []) as { customer_id: string }[]).map((i) => i.customer_id)
  );

  // Which customers have a real visit this week (scheduled or completed).
  // No visit = no invoice; this is what respects frequency_weeks.
  const { data: visitData } = await sb
    .from('appointments')
    .select('customer_id')
    .gte('scheduled_at', week.periodStart)
    .lte('scheduled_at', week.periodEnd)
    .in('status', ['scheduled', 'completed']);
  const visitingIds = new Set(
    ((visitData ?? []) as { customer_id: string }[]).map((a) => a.customer_id)
  );

  const results: GenResult[] = [];

  for (const c of customers) {
    const name = `${c.first_name} ${c.last_name}`.trim();

    if (existingIds.has(c.id)) {
      results.push({ name, status: 'skipped (already invoiced this week)' });
      continue;
    }
    if (!visitingIds.has(c.id)) {
      results.push({ name, status: 'skipped (no visit this week)' });
      continue;
    }
    if (!c.price_per_visit) {
      results.push({ name, status: 'skipped (no price set)' });
      continue;
    }

    const { error } = await sb.from('invoices').insert({
      customer_id: c.id,
      amount: c.price_per_visit,
      status: 'sent',
      due_date: dueDateFor(c, week),
      period_start: week.periodStart,
      period_end: week.periodEnd,
      notes: `Week of ${week.weekLabel} - ${c.service_type || 'Visit'}`,
    });

    results.push({
      name,
      amount: c.price_per_visit,
      status: error ? `error ${error.message}` : 'created',
    });
  }

  const created = results.filter((r) => r.status === 'created').length;
  const skipped = results.filter((r) => r.status.startsWith('skipped')).length;

  return NextResponse.json({ week: week.weekLabel, created, skipped, results });
}

export async function GET(request: Request) {
  return generate(request);
}

export async function POST(request: Request) {
  return generate(request);
}
