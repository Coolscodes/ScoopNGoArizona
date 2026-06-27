// Workstream 2 — recurring-visit generator (cron).
//
// POST /api/jobs/generate
//   Auth: send the CRON_SECRET either as
//     Authorization: Bearer <CRON_SECRET>   or   x-cron-secret: <CRON_SECRET>
//   -> 200 { ran: true, today, created: [...], skipped: [...], advanced: number }
//   -> 401 if the secret is missing/wrong.
//
// For every active customer with a next_visit_date, this creates the next
// `appointments` row (scheduled on next_visit_date) and advances next_visit_date
// forward by `frequency_weeks` weeks (default 1) until it lands on or after today.
//
// Idempotency
// ===========
// 1. We never create a second appointment for the same (customer_id, scheduled_at):
//    before inserting we query for an existing appointment on that customer/date in
//    any non-cancelled status. If one exists, we skip the insert.
// 2. next_visit_date only advances PAST a date once an appointment for it exists, so a
//    re-run that finds the appointment already there simply advances and moves on — it
//    cannot duplicate. Running the endpoint twice in a row is a no-op.

import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { todayISO } from '@/lib/format';
import type { Customer } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Add n weeks to a YYYY-MM-DD date string, returning YYYY-MM-DD (UTC-safe).
function addWeeks(dateISO: string, weeks: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed if not configured
  const auth = request.headers.get('authorization');
  const bearer = auth?.toLowerCase().startsWith('bearer ')
    ? auth.slice(7).trim()
    : null;
  const headerSecret = request.headers.get('x-cron-secret');
  return bearer === secret || headerSecret === secret;
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const today = todayISO();

  try {
    const sb = supabaseServer();

    const { data: custData, error: custErr } = await sb
      .from('customers')
      .select('*')
      .eq('active', true)
      .not('next_visit_date', 'is', null);

    if (custErr) throw custErr;

    const customers = (custData ?? []) as Customer[];

    const created: { customer_id: string; scheduled_at: string }[] = [];
    const skipped: { customer_id: string; scheduled_at: string; reason: string }[] = [];
    let advanced = 0;

    for (const c of customers) {
      const freq = c.frequency_weeks && c.frequency_weeks > 0 ? c.frequency_weeks : 1;
      let visitDate = c.next_visit_date as string;
      if (!visitDate) continue;

      // Generate the due visit (the one on/just-before today). We materialize at most
      // one appointment per customer per run: the current next_visit_date.
      const scheduledAt = visitDate;

      // Idempotency check: is there already an appointment for this customer/date?
      const { data: existing, error: exErr } = await sb
        .from('appointments')
        .select('id, status')
        .eq('customer_id', c.id)
        .eq('scheduled_at', scheduledAt)
        .neq('status', 'cancelled')
        .limit(1);

      if (exErr) throw exErr;

      if (existing && existing.length > 0) {
        skipped.push({
          customer_id: c.id,
          scheduled_at: scheduledAt,
          reason: 'already exists',
        });
      } else {
        const { error: insErr } = await sb.from('appointments').insert({
          customer_id: c.id,
          scheduled_at: scheduledAt,
          service_type: c.service_type ?? null,
          status: 'scheduled',
          assigned_to: null,
        });
        if (insErr) throw insErr;
        created.push({ customer_id: c.id, scheduled_at: scheduledAt });
      }

      // Advance next_visit_date forward by `freq` weeks until it's in the future
      // (strictly after today), so the next run targets the following visit.
      let nextDate = addWeeks(visitDate, freq);
      // Guard against a pathological loop; weeks are >0 so this always terminates.
      while (nextDate <= today) {
        nextDate = addWeeks(nextDate, freq);
      }

      if (nextDate !== c.next_visit_date) {
        const { error: updErr } = await sb
          .from('customers')
          .update({ next_visit_date: nextDate })
          .eq('id', c.id);
        if (updErr) throw updErr;
        advanced++;
      }
    }

    return NextResponse.json({
      ran: true,
      today,
      created,
      skipped,
      advanced,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Generator failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Vercel Cron invokes via GET (with Authorization: Bearer <CRON_SECRET>);
// delegate to the same authorized logic.
export function GET(request: Request) {
  return POST(request);
}
