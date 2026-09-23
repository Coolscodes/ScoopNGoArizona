// Did she pay the signup link yet, and if so, finish the job.
//
//   POST /api/signup/confirm  { customer_id }
//     -> 200 { paid, card_saved, amount?, weeks?, first_charged_visit?, reason? }
//
// The signup link (/api/signup/link) hands off to Stripe, so the answer comes
// back from Stripe rather than from us. This asks Stripe for that client's
// recent Checkout sessions, and when it finds a paid signup session it does the
// two things that were waiting on the money:
//
//   1. Keeps the card. setup_future_usage already attached it to the Stripe
//      customer; this makes it the default and writes it to Supabase, which is
//      what the rest of HQ reads to know there is a card on file.
//   2. Books the covered weeks, exactly as /api/signup/collect would have.
//
// Safe to call as often as he likes: paid weeks are left alone, and the card
// save is the same write every time.
//
// This deliberately does not use a Stripe webhook. The live webhook lives in
// the marketing site deployment, not here, and pointing a second endpoint at
// HQ would mean this logic existing in two codebases and a dashboard step to
// set up. He is standing in the app anyway when he asks.
//
// Staff session only.

import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { supabaseServer } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/auth';
import { bookCoveredWeeks } from '@/lib/signup-booking';
import { todayISO } from '@/lib/format';
import type { Customer } from '@/lib/types';
import {
  coveredVisits,
  firstChargedVisit,
  isISODate,
  round2,
  type SignupPlan,
} from '@/lib/signup-plan';

export const dynamic = 'force-dynamic';

function num(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : fallback;
}

// The most recent paid signup Checkout session for this Stripe customer.
async function findPaidSignupSession(
  sk: Stripe,
  stripeCustomerId: string
): Promise<Stripe.Checkout.Session | null> {
  const list = await sk.checkout.sessions.list({ customer: stripeCustomerId, limit: 20 });
  const paid = list.data.filter(
    (s) => s.metadata?.signup === 'true' && s.payment_status === 'paid'
  );
  // list() comes back newest first, but do not lean on that.
  paid.sort((a, b) => b.created - a.created);
  return paid[0] ?? null;
}

// Attach the card she just paid with to the customer as their default, and
// record it in Supabase so HQ shows "card on file".
async function keepTheCard(
  sk: Stripe,
  sb: ReturnType<typeof supabaseServer>,
  customer: Customer,
  session: Stripe.Checkout.Session
): Promise<boolean> {
  const piId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id;
  if (!piId || !session.customer) return false;
  const stripeCustomerId =
    typeof session.customer === 'string' ? session.customer : session.customer.id;

  try {
    const pi = await sk.paymentIntents.retrieve(piId);
    const pmId = typeof pi.payment_method === 'string' ? pi.payment_method : pi.payment_method?.id;
    if (!pmId) return false;

    await sk.customers.update(stripeCustomerId, {
      invoice_settings: { default_payment_method: pmId },
    });
    await sb
      .from('customers')
      .update({ stripe_payment_method_id: pmId, stripe_customer_id: stripeCustomerId })
      .eq('id', customer.id);
    return true;
  } catch {
    // The money is in either way. He can still send a card setup link.
    return false;
  }
}

export async function POST(request: Request) {
  try {
    if (!(await getCurrentUser())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { customer_id?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body.customer_id) {
    return NextResponse.json({ error: 'customer_id is required' }, { status: 400 });
  }

  const sb = supabaseServer();
  const { data } = await sb.from('customers').select('*').eq('id', body.customer_id).maybeSingle();
  const customer = data as Customer | null;
  if (!customer) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }
  if (!customer.stripe_customer_id) {
    return NextResponse.json({
      paid: false,
      card_saved: false,
      reason: 'No signup link has been created for her yet.',
    });
  }

  let session: Stripe.Checkout.Session | null;
  const sk = stripe();
  try {
    session = await findPaidSignupSession(sk, customer.stripe_customer_id);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not reach Stripe';
    return NextResponse.json({ error: message }, { status: 502 });
  }

  if (!session) {
    return NextResponse.json({
      paid: false,
      card_saved: Boolean(customer.stripe_payment_method_id),
      reason: 'She has not finished the payment link yet.',
    });
  }

  const cardSaved = await keepTheCard(sk, sb, customer, session);

  // The plan is read off the session, so it is whatever the link was created
  // for, not whatever the browser is holding now.
  const meta = session.metadata ?? {};
  const amount = round2(
    num(meta.signup_amount, (session.amount_total ?? 0) / 100)
  );
  const covered = Math.max(0, Math.round(num(meta.covered_visits, 0)));
  const plan: SignupPlan = {
    price_per_visit: Number(customer.price_per_visit) || 0,
    frequency_weeks:
      customer.frequency_weeks && customer.frequency_weeks > 0 ? customer.frequency_weeks : 1,
    covered_visits: covered,
    free_visits: Math.min(covered, Math.max(0, Math.round(num(meta.free_visits, 0)))),
    signup_total: amount,
  };
  const firstVisit = isISODate(meta.first_visit)
    ? meta.first_visit
    : customer.start_date && isISODate(customer.start_date)
    ? customer.start_date
    : todayISO();

  if (!plan.covered_visits) {
    // Paid, but the link did not carry a schedule (nothing to mark).
    return NextResponse.json({ paid: true, card_saved: cardSaved, amount, weeks: [] });
  }

  const weeks = coveredVisits(firstVisit, plan);
  const piId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id;

  const { weeks: booked, problems } = await bookCoveredWeeks(sb, customer, weeks, {
    method: 'card',
    label: `$${amount.toFixed(2)} signup`,
    reference: piId ?? undefined,
  });

  return NextResponse.json({
    paid: true,
    card_saved: cardSaved,
    amount,
    weeks: booked,
    first_charged_visit: firstChargedVisit(firstVisit, plan),
    ...(problems.length ? { problems } : {}),
  });
}
