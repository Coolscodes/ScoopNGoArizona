// Collect the signup payment for a new client and mark the weeks it bought.
//
//   POST /api/signup/collect
//     { customer_id, method, amount, covered_visits, free_visits,
//       first_visit_date? }
//     -> 200 { ok, charged, weeks, first_charged_visit }
//     -> 402 when the card declines (nothing is written)
//     -> 409 when those weeks are already paid
//
// Why it writes one invoice per week instead of a single $60 invoice spanning
// four: the auto-charge looks for a PAID invoice whose period_start is exactly
// this week's Monday (see autoChargeOnCompletion). A single wide invoice would
// only protect the first week and the client would be charged again for weeks
// two through four. One invoice per covered week is also what makes the weekly
// revenue chart credit the money to the week that was actually serviced.
//
// The free visit gets a $0 paid invoice. It earns nothing, which is correct,
// and it still blocks the auto-charge for that week.
//
// Staff session only.

import { NextResponse } from 'next/server';
import { stripe, dollarsToCents } from '@/lib/stripe';
import { supabaseServer } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/auth';
import { defaultPaymentMethodFor } from '@/lib/charge-core';
import { bookCoveredWeeks, invoiceStatusByWeek } from '@/lib/signup-booking';
import { fullName, todayISO } from '@/lib/format';
import type { Customer, PayMethod } from '@/lib/types';
import {
  coveredVisits,
  firstChargedVisit,
  isISODate,
  round2,
  type SignupPlan,
} from '@/lib/signup-plan';

export const dynamic = 'force-dynamic';

const METHODS: PayMethod[] = ['card', 'cash', 'venmo', 'zelle', 'check', 'applepay'];

function num(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : fallback;
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
    customer_id?: string;
    method?: string;
    amount?: number;
    covered_visits?: number;
    free_visits?: number;
    first_visit_date?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.customer_id) {
    return NextResponse.json({ error: 'customer_id is required' }, { status: 400 });
  }
  const method = (METHODS.includes(body.method as PayMethod) ? body.method : 'card') as PayMethod;
  const amount = round2(Math.max(0, num(body.amount, 0)));

  const sb = supabaseServer();
  const { data: custData } = await sb
    .from('customers')
    .select('*')
    .eq('id', body.customer_id)
    .maybeSingle();
  const customer = custData as Customer | null;
  if (!customer) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  // Cadence and price come from the saved client, the offer shape from the
  // request. The browser cannot invent a schedule the client is not on.
  const covered = Math.max(0, Math.round(num(body.covered_visits, 0)));
  const plan: SignupPlan = {
    price_per_visit: Number(customer.price_per_visit) || 0,
    frequency_weeks:
      customer.frequency_weeks && customer.frequency_weeks > 0 ? customer.frequency_weeks : 1,
    covered_visits: covered,
    free_visits: Math.min(covered, Math.max(0, Math.round(num(body.free_visits, 0)))),
    signup_total: amount,
  };
  if (!plan.covered_visits) {
    return NextResponse.json({ error: 'Nothing to collect, covered_visits is 0' }, { status: 400 });
  }
  // A zero amount here would quietly mark every covered week free, which is not
  // what "collect" means. Comped visits are booked at signup instead.
  if (amount <= 0) {
    return NextResponse.json({ error: 'Enter the amount collected' }, { status: 400 });
  }

  const firstVisit = isISODate(body.first_visit_date)
    ? body.first_visit_date
    : customer.start_date && isISODate(customer.start_date)
    ? customer.start_date
    : todayISO();

  const weeks = coveredVisits(firstVisit, plan);

  // Already-collected guard. Re-tapping Collect must not charge the card twice.
  const existingByWeek = await invoiceStatusByWeek(
    sb,
    customer.id,
    weeks.map((w) => w.periodStart)
  );
  const allPaid = weeks.every((w) => existingByWeek.get(w.periodStart)?.status === 'paid');
  if (allPaid) {
    return NextResponse.json(
      { error: 'Those weeks are already marked paid. Nothing was charged.' },
      { status: 409 }
    );
  }

  // --- take the money ---------------------------------------------------------

  let paymentIntentId: string | undefined;
  if (method === 'card' && amount > 0) {
    if (!customer.stripe_customer_id) {
      return NextResponse.json(
        { error: 'No card on file yet. Send the card setup link first.' },
        { status: 402 }
      );
    }
    try {
      const sk = stripe();
      const pmId = await defaultPaymentMethodFor(sk, customer.stripe_customer_id);
      if (!pmId) {
        return NextResponse.json(
          { error: 'No saved card found. Send the card setup link first.' },
          { status: 402 }
        );
      }
      const pi = await sk.paymentIntents.create({
        amount: dollarsToCents(amount),
        currency: 'usd',
        customer: customer.stripe_customer_id,
        payment_method: pmId,
        confirm: true,
        off_session: true,
        description: `Scoop N Go Arizona signup: ${weeks.length} visits from ${firstVisit}`,
        metadata: {
          customer_id: customer.id,
          customer_name: fullName(customer),
          signup: 'true',
          first_visit: firstVisit,
          covered_visits: String(weeks.length),
        },
      });
      if (pi.status !== 'succeeded') {
        return NextResponse.json(
          { error: `Card was not charged (${pi.status}). Nothing was recorded.` },
          { status: 402 }
        );
      }
      paymentIntentId = pi.id;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Charge failed';
      return NextResponse.json({ error: message }, { status: 402 });
    }
  }

  // --- book the weeks ---------------------------------------------------------

  const { weeks: booked, problems } = await bookCoveredWeeks(
    sb,
    customer,
    weeks,
    {
      method,
      label: `$${amount.toFixed(2)} signup`,
      reference: paymentIntentId,
    },
    existingByWeek
  );

  return NextResponse.json({
    ok: problems.length === 0,
    charged: Boolean(paymentIntentId),
    method,
    amount,
    weeks: booked,
    first_charged_visit: firstChargedVisit(firstVisit, plan),
    ...(problems.length ? { problems } : {}),
  });
}
