// Workstream 2, recurring-visit generator (cron).
//
// POST /api/jobs/generate
//   Auth: send the CRON_SECRET either as
//     Authorization: Bearer <CRON_SECRET>   or   x-cron-secret: <CRON_SECRET>
//   -> 200 { ran: true, today, created: [...], skipped: [...], advanced: number }
//   -> 401 if the secret is missing/wrong.
//
// For every active customer with a next_visit_date, this materializes every visit
// that has come due through the horizon (today + HORIZON_DAYS) and leaves
// next_visit_date pointing at the first visit beyond it.
//
// The horizon is what keeps the schedule stable. Two earlier bugs both came from
// creating exactly one appointment per run and then moving next_visit_date to
// strictly after today:
//   1. A missed run skipped those weeks forever. When the daily cron sat dead
//      from 2026-07-17 to 2026-09-04, the first run back would have created one
//      visit dated 2026-08-14 and jumped straight past the three weeks between.
//   2. A healthy daily run walked the schedule into the future, one week further
//      every day, because it kept materializing an already-future next_visit_date.
//
// Idempotency
// ===========
// 1. We never create a second appointment for the same (customer_id, scheduled_at):
//    before inserting we query for an existing appointment on that customer/date in
//    any non-cancelled status. If one exists, we skip the insert.
// 2. next_visit_date only advances past a date once an appointment for it exists,
//    and the horizon is a function of today, so a second run on the same day finds
//    every visit already there and changes nothing. Running it twice is a no-op.
// 3. One customer's failure is recorded and skipped, it does not abort the rest.

import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { todayISO } from '@/lib/format';
import type { Customer } from '@/lib/types';

export const dynamic = 'force-dynamic';

// How far ahead to materialize visits. A week means the upcoming route is always
// on the books without the schedule running away into the future.
const HORIZON_DAYS = 7;

// Ceiling on catch-up per customer per run, so a long outage cannot insert
// hundreds of rows in one go. The remainder is picked up by the next run.
const MAX_CATCHUP = 12;

// Add n days / weeks to a YYYY-MM-DD date string, returning YYYY-MM-DD (UTC-safe).
function addDays(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function addWeeks(dateISO: string, weeks: number): string {
  return addDays(dateISO, weeks * 7);
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
    const failed: { customer_id: string; error: string }[] = [];
    let advanced = 0;

    // Materialize everything due on or before this date, then stop.
    const horizon = addDays(today, HORIZON_DAYS);

    for (const c of customers) {
      const freq = c.frequency_weeks && c.frequency_weeks > 0 ? c.frequency_weeks : 1;
      let visitDate = c.next_visit_date as string;
      if (!visitDate) continue;

      try {
        // Walk forward one cycle at a time, creating every visit due through the
        // horizon. A caught-up run does nothing; a run after an outage backfills
        // the weeks that were missed, capped at MAX_CATCHUP.
        let madeForCustomer = 0;
        while (visitDate <= horizon && madeForCustomer < MAX_CATCHUP) {
          // Idempotency check: is there already an appointment for this customer/date?
          const { data: existing, error: exErr } = await sb
            .from('appointments')
            .select('id, status')
            .eq('customer_id', c.id)
            .eq('scheduled_at', visitDate)
            .neq('status', 'cancelled')
            .limit(1);

          if (exErr) throw exErr;

          if (existing && existing.length > 0) {
            skipped.push({
              customer_id: c.id,
              scheduled_at: visitDate,
              reason: 'already exists',
            });
          } else {
            const { error: insErr } = await sb.from('appointments').insert({
              customer_id: c.id,
              scheduled_at: visitDate,
              service_type: c.service_type ?? null,
              status: 'scheduled',
              assigned_to: null,
              // Inherit the client's standing route order so the new route comes up
              // pre-sorted (undefined before migration 002, falls back to null).
              route_position: c.route_order ?? null,
            });
            if (insErr) throw insErr;
            created.push({ customer_id: c.id, scheduled_at: visitDate });
          }

          visitDate = addWeeks(visitDate, freq);
          madeForCustomer++;
        }

        // visitDate is now the first visit past the horizon, which is exactly what
        // the next run should pick up from.
        if (visitDate !== c.next_visit_date) {
          const { error: updErr } = await sb
            .from('customers')
            .update({ next_visit_date: visitDate })
            .eq('id', c.id);
          if (updErr) throw updErr;
          advanced++;
        }
      } catch (err) {
        // One bad customer must not stall the whole route.
        failed.push({
          customer_id: c.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return NextResponse.json({
      ran: true,
      today,
      horizon,
      created,
      skipped,
      failed,
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
