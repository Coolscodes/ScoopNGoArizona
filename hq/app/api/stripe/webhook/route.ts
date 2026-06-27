// Workstream 6 — Stripe webhook.
// PORT of the repo-root /api/stripe-webhook.js, preserving its tested behavior.
//
// Stripe needs the RAW request body for signature verification, so we read
// `await request.text()` and verify with stripe().webhooks.constructEvent using
// STRIPE_WEBHOOK_SECRET. force-dynamic so the body is never cached/parsed early.
//
// Handled events (verbatim logic from the original):
//   setup_intent.succeeded
//     - Set the saved payment method as the customer's default in Stripe.
//     - Save stripe_payment_method_id + stripe_customer_id back to Supabase.
//   checkout.session.completed
//     - mode=setup fallback: pull the SetupIntent's payment method, set default,
//       persist to Supabase (covers the case where setup_intent.succeeded isn't
//       subscribed).
//     - invoice_id in metadata: mark that invoice paid.
//     - plan in metadata (no invoice_id): auto-create a customer + dog rows for
//       an online subscriber and email the owner.

import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { supabaseServer } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const OWNER_EMAIL = 'scoopngoarizona@gmail.com';

export async function POST(request: Request) {
  const rawBody = await request.text();
  const sig = request.headers.get('stripe-signature') || '';
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const sk = stripe();
  const sb = supabaseServer();

  // Verify the signature. If the secret is configured (it should be), an invalid
  // signature is rejected; if it's unset we fall back to parsing (dev only).
  let event: Stripe.Event;
  if (webhookSecret) {
    try {
      event = sk.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }
  } else {
    try {
      event = JSON.parse(rawBody) as Stripe.Event;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
  }

  // Most reliable: setup_intent.succeeded carries the payment_method directly.
  if (event.type === 'setup_intent.succeeded') {
    const si = event.data.object as Stripe.SetupIntent;
    const customerId = si.metadata?.customer_id;
    const pmId = typeof si.payment_method === 'string' ? si.payment_method : si.payment_method?.id;
    const stripeCustomerId =
      typeof si.customer === 'string' ? si.customer : si.customer?.id;

    if (customerId && pmId && stripeCustomerId) {
      // Set as default payment method on the Stripe customer.
      await sk.customers.update(stripeCustomerId, {
        invoice_settings: { default_payment_method: pmId },
      });
      // Save to Supabase.
      await sb
        .from('customers')
        .update({
          stripe_payment_method_id: pmId,
          stripe_customer_id: stripeCustomerId,
        })
        .eq('id', customerId);
    }
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const meta = session.metadata || {};
    const { invoice_id, plan, dogs, deodorizer, customer_name, customer_id } = meta;
    const sessionCustomerId =
      typeof session.customer === 'string' ? session.customer : session.customer?.id;

    // Fallback: handle setup via checkout session in case setup_intent.succeeded
    // isn't subscribed.
    if (session.mode === 'setup' && customer_id && session.setup_intent) {
      const setupIntentId =
        typeof session.setup_intent === 'string'
          ? session.setup_intent
          : session.setup_intent.id;
      const si = await sk.setupIntents.retrieve(setupIntentId);
      const pmId =
        typeof si.payment_method === 'string' ? si.payment_method : si.payment_method?.id;
      if (pmId && sessionCustomerId) {
        await sk.customers.update(sessionCustomerId, {
          invoice_settings: { default_payment_method: pmId },
        });
        await sb
          .from('customers')
          .update({
            stripe_payment_method_id: pmId,
            stripe_customer_id: sessionCustomerId,
          })
          .eq('id', customer_id);
      }
    }

    // 1. Mark invoice paid (admin-generated payment links).
    if (invoice_id) {
      await sb.from('invoices').update({ status: 'paid' }).eq('id', invoice_id);
    }

    // 2. Auto-create customer when someone subscribes online.
    if (plan && !invoice_id) {
      const email = session.customer_details?.email || '';
      const phone = session.customer_details?.phone || '';
      const name = session.customer_details?.name || customer_name || '';
      const [firstName, ...rest] = name.split(' ');
      const lastName = rest.join(' ');

      const planLabel =
        ({ weekly: 'Weekly', biweekly: 'Bi-Weekly', monthly: 'Monthly' } as Record<string, string>)[
          plan
        ] || plan;
      const dogCount = parseInt(dogs || '', 10) || 1;
      const hasDeod = deodorizer === 'true';

      const { data: insertedCustomer } = await sb
        .from('customers')
        .insert({
          first_name: firstName || 'Online',
          last_name: lastName || 'Subscriber',
          email,
          phone,
          address: '',
          city: '',
          zip: '',
          service_type: planLabel,
          status: 'active',
          stripe_customer_id: sessionCustomerId || '',
          notes: `Subscribed online via Stripe. ${dogCount} dog${
            dogCount > 1 ? 's' : ''
          }${hasDeod ? ' + deodorizer' : ''}.`,
        })
        .select('id')
        .single();

      const newCustomerId = (insertedCustomer as { id: string } | null)?.id;

      if (newCustomerId) {
        for (let i = 0; i < dogCount; i++) {
          await sb.from('dogs').insert({
            customer_id: newCustomerId,
            name: dogCount === 1 ? 'Dog' : `Dog ${i + 1}`,
            breed: '',
            notes: '',
          });
        }
      }

      // Owner notification email.
      const resendKey = process.env.RESEND_API_KEY;
      if (resendKey) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'Scoop N Go Arizona <onboarding@resend.dev>',
            to: OWNER_EMAIL,
            reply_to: email || 'noreply@stripe.com',
            subject: `💳 New Online Subscriber: ${name || 'New Client'} (${planLabel})`,
            text: `
New subscription payment received!

Name:     ${name || 'Unknown'}
Email:    ${email || 'Not provided'}
Phone:    ${phone || 'Not provided'}
Plan:     ${planLabel}
Dogs:     ${dogCount}
Deod:     ${hasDeod ? 'Yes' : 'No'}

This client has been automatically added to your Customers tab in the admin dashboard.
Log in at https://scoopngoarizona.com/admin to schedule their first service.

Stripe Customer ID: ${sessionCustomerId || 'N/A'}
            `.trim(),
          }),
        });
      }
    }
  }

  return NextResponse.json({ received: true });
}
