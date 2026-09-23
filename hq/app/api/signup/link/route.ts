// The signup payment link: one hosted Stripe page that takes the signup money
// AND keeps the card she pays with.
//
//   POST /api/signup/link
//     { customer_id, amount, covered_visits, free_visits, first_visit_date? }
//     -> 200 { url, session_id, stripe_customer_id }
//
// Why this exists next to /api/stripe/setup: that link saves a card and charges
// nothing, which means a new client has to get out her card twice, once to save
// it and once to pay the signup. This is a Checkout session in `payment` mode
// with setup_future_usage set to off_session, so the card that pays the $60 is
// attached to the Stripe customer and can be charged again later without her
// doing anything. The setup link stays for clients who are not prepaying.
//
// Nothing is written to the books here. Stripe tells us it was paid, and
// POST /api/signup/confirm is what reads that and marks the weeks.
//
// Staff session only.

import { NextResponse } from 'next/server';
import { stripe, dollarsToCents } from '@/lib/stripe';
import { supabaseServer } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/auth';
import { fullName, todayISO } from '@/lib/format';
import type { Customer } from '@/lib/types';
import { cadenceLabel, isISODate, round2 } from '@/lib/signup-plan';

export const dynamic = 'force-dynamic';

const ORIGIN = process.env.NEXT_PUBLIC_BASE_URL || 'https://scoopngoarizona.com';

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
  const amount = round2(num(body.amount, 0));
  if (amount <= 0) {
    return NextResponse.json({ error: 'Amount must be more than $0' }, { status: 400 });
  }

  const sb = supabaseServer();
  const { data } = await sb
    .from('customers')
    .select('*')
    .eq('id', body.customer_id)
    .maybeSingle();
  const customer = data as Customer | null;
  if (!customer) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const covered = Math.max(0, Math.round(num(body.covered_visits, 0)));
  const free = Math.min(covered, Math.max(0, Math.round(num(body.free_visits, 0))));
  const firstVisit = isISODate(body.first_visit_date)
    ? body.first_visit_date
    : customer.start_date && isISODate(customer.start_date)
    ? customer.start_date
    : todayISO();
  const name = fullName(customer) || 'Customer';

  try {
    const sk = stripe();

    // Same customer the card setup link would have used, created here when she
    // has never been billed before.
    let stripeCustomerId = customer.stripe_customer_id;
    if (!stripeCustomerId) {
      const created = await sk.customers.create({
        name,
        ...(customer.email ? { email: customer.email } : {}),
        metadata: { supabase_id: customer.id },
      });
      stripeCustomerId = created.id;
      await sb
        .from('customers')
        .update({ stripe_customer_id: stripeCustomerId })
        .eq('id', customer.id);
    }

    const freq = customer.frequency_weeks && customer.frequency_weeks > 0 ? customer.frequency_weeks : 1;
    const paidVisits = Math.max(0, covered - free);
    const description = covered
      ? `${covered} visits${free ? `, first ${free > 1 ? `${free} ` : ''}free` : ''}, then ${
          customer.price_per_visit ? `$${customer.price_per_visit}` : 'your rate'
        } every ${cadenceLabel(freq)}`
      : 'Signup';

    const session = await sk.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: dollarsToCents(amount),
            product_data: {
              name: 'Scoop N Go Arizona signup',
              description,
            },
          },
        },
      ],
      // This is the whole point: keep the card she pays with, so the ongoing
      // visits can be charged later without asking her for it again.
      payment_intent_data: {
        setup_future_usage: 'off_session',
        description: `Scoop N Go Arizona signup: ${name}`,
        metadata: {
          customer_id: customer.id,
          customer_name: name,
          signup: 'true',
        },
      },
      success_url: `${ORIGIN}/payment-success?type=intro&name=${encodeURIComponent(name)}`,
      cancel_url: `${ORIGIN}/`,
      // Read back by /api/signup/confirm, so the weeks it books do not depend
      // on whatever the browser happens to be holding at the time.
      metadata: {
        customer_id: customer.id,
        customer_name: name,
        signup: 'true',
        signup_amount: String(amount),
        covered_visits: String(covered),
        free_visits: String(free),
        paid_visits: String(paidVisits),
        first_visit: firstVisit,
      },
    });

    if (!session.url) throw new Error('Stripe did not return a Checkout URL');
    return NextResponse.json({
      url: session.url,
      session_id: session.id,
      stripe_customer_id: stripeCustomerId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Stripe error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
