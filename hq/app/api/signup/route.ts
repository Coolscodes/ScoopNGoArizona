// New-client signup (the /signup screen).
//
//   POST /api/signup
//     { client: {...}, plan: {...}, first_visit_date, auto_charge?, dogs? }
//     -> 201 { client, covered, first_charged_visit }
//
// This is the "put her on the books" half. It creates the customer with the
// plan already set (price, cadence, first visit, auto-charge) and adds her
// dogs. It deliberately takes no money: the card is not on file yet at this
// point in the conversation. POST /api/signup/collect does that afterwards.
//
// Staff session only (middleware guards everything under /api that is not in
// its public list; this checks again rather than trusting that).

import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/auth';
import { describeDbError } from '@/lib/db-error';
import type { Customer } from '@/lib/types';
import {
  coveredVisits,
  firstChargedVisit,
  isISODate,
  serviceTypeFor,
  weekdayName,
  type SignupPlan,
} from '@/lib/signup-plan';

export const dynamic = 'force-dynamic';

// Text fields copied straight onto the customer row.
const CLIENT_FIELDS = [
  'first_name', 'last_name', 'phone', 'email', 'address', 'city', 'zip',
  'gate_code', 'yard_notes',
] as const;

function num(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : fallback;
}

// Reads the plan out of the request, clamped to values the rest of the code can
// actually work with (a zero cadence would loop forever downstream).
function readPlan(raw: Record<string, unknown> | undefined): SignupPlan {
  const p = raw ?? {};
  const covered = Math.max(0, Math.round(num(p.covered_visits, 0)));
  return {
    price_per_visit: Math.max(0, num(p.price_per_visit, 0)),
    frequency_weeks: Math.max(1, Math.round(num(p.frequency_weeks, 1))),
    covered_visits: covered,
    free_visits: Math.min(covered, Math.max(0, Math.round(num(p.free_visits, 0)))),
    signup_total: Math.max(0, num(p.signup_total, 0)),
  };
}

export async function POST(request: Request) {
  try {
    if (!(await getCurrentUser())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: {
    client?: Record<string, unknown>;
    plan?: Record<string, unknown>;
    first_visit_date?: string;
    auto_charge?: boolean;
    dogs?: unknown;
    dog_count?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const client = body.client ?? {};
  const firstName = String(client.first_name ?? '').trim();
  const phone = String(client.phone ?? '').trim();
  if (!firstName) {
    return NextResponse.json({ error: 'First name is required' }, { status: 400 });
  }
  if (!phone) {
    return NextResponse.json({ error: 'Phone is required' }, { status: 400 });
  }
  if (!isISODate(body.first_visit_date)) {
    return NextResponse.json(
      { error: 'first_visit_date (YYYY-MM-DD) is required' },
      { status: 400 }
    );
  }

  const plan = readPlan(body.plan);
  const firstVisit = body.first_visit_date;

  const row: Record<string, unknown> = {
    active: true,
    auto_charge: body.auto_charge !== false,
    service_type: serviceTypeFor(plan.frequency_weeks),
    // The route day is the day of the first visit, so the two can never
    // disagree the way they do when both are typed in by hand.
    preferred_day: weekdayName(firstVisit),
    price_per_visit: plan.price_per_visit || null,
    frequency_weeks: plan.frequency_weeks,
    start_date: firstVisit,
    // The generator materializes appointments from here forward.
    next_visit_date: firstVisit,
  };
  for (const key of CLIENT_FIELDS) {
    const value = client[key];
    if (value === undefined) continue;
    row[key] = typeof value === 'string' && !value.trim() ? null : value;
  }

  try {
    const sb = supabaseServer();
    const { data, error } = await sb.from('customers').insert(row).select('*').single();
    if (error) throw error;
    const created = data as Customer;

    // Dogs are a nice-to-have on a signup: a failure here must not lose the
    // client that was just created, so it is reported, not thrown.
    //
    // A count is what actually gets collected in the driveway ("she's got
    // two"), so dog_count is the normal path and names are optional. The
    // placeholder names match what the website signup writes, and the clients
    // table only ever shows the row count anyway.
    const named = Array.isArray(body.dogs)
      ? (body.dogs as unknown[])
          .map((d) => (typeof d === 'string' ? d : String((d as { name?: string })?.name ?? '')))
          .map((n) => n.trim())
          .filter(Boolean)
          .slice(0, 12)
      : [];
    const count = Math.min(12, Math.max(0, Math.round(num(body.dog_count, 0))));
    const dogNames = named.length
      ? named
      : count === 1
      ? ['Dog']
      : Array.from({ length: count }, (_, i) => `Dog ${i + 1}`);
    let dogsError: string | undefined;
    if (dogNames.length) {
      const { error: dogErr } = await sb
        .from('dogs')
        .insert(dogNames.map((name) => ({ customer_id: created.id, name })));
      if (dogErr) dogsError = dogErr.message;
    }

    // Book the comped visits right now, as $0 paid invoices. The free week is
    // a promise made at signup, not something contingent on the signup money
    // arriving: without this, completing that first visit would auto-charge her
    // full price on a week she was told was free. The weeks the payment buys
    // are booked later, by /api/signup/collect.
    const covered = coveredVisits(firstVisit, plan);
    const freeVisits = covered.filter((v) => v.free);
    let invoiceError: string | undefined;
    if (freeVisits.length) {
      const { error: invErr } = await sb.from('invoices').insert(
        freeVisits.map((v) => ({
          customer_id: created.id,
          amount: 0,
          status: 'paid',
          due_date: v.visitDate,
          period_start: v.periodStart,
          period_end: v.periodEnd,
          notes: `Week of ${v.weekLabel}, first visit free (signup offer)`,
        }))
      );
      if (invErr) invoiceError = invErr.message;
    }

    return NextResponse.json(
      {
        client: created,
        covered,
        free_booked: invoiceError ? 0 : freeVisits.length,
        first_charged_visit: firstChargedVisit(firstVisit, plan),
        ...(dogsError ? { dogs_error: dogsError } : {}),
        ...(invoiceError ? { invoice_error: invoiceError } : {}),
      },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: describeDbError(err, 'Failed to create client') },
      { status: 500 }
    );
  }
}
