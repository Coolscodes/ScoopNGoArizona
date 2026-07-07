// Workstream 6, Stripe card-on-file setup link.
// PORT of the repo-root /api/stripe-setup.js. Exposed at EXACTLY /api/stripe/setup
// because Workstream 7 (customer portal) links here for "update card".
//
// Behavior preserved from the original:
//   - If the customer has no stripe_customer_id, create a Stripe customer
//     (name + optional email + metadata[supabase_id]) and save the id back to
//     Supabase.
//   - Create a Stripe Checkout session in `setup` mode (card), carrying the
//     metadata the webhook reads (customer_id, customer_name, setup_for, and
//     setup_intent_data.metadata.customer_id/customer_name).
//   - Return { url, stripe_customer_id }.
//
// Auth (this route is under /api/, which middleware leaves unguarded, so it
// authorizes itself; never trusts the browser for the customer record):
//   - Staff: send the CRON_SECRET (Bearer or x-cron-secret). The id/name/email
//     may come in the POST body.
//   - Customer portal (WS7): pass the customer's portal_token; it must match the
//     stored token for that customer. No secret required for that path.
//
// Request shapes (documented for WS7):
//   POST /api/stripe/setup
//     body: { customer_id: string, token?: string,                 // portal_token
//             customer_name?: string, customer_email?: string,
//             stripe_customer_id?: string }
//     headers (staff): Authorization: Bearer <CRON_SECRET>  OR  x-cron-secret
//     -> 200 { url, stripe_customer_id }
//   GET /api/stripe/setup?customer_id=<id>&token=<portal_token>
//     -> 303 redirect to the Stripe Checkout URL (convenient emailable link)

import { NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { supabaseServer } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/auth';
import type { Customer } from '@/lib/types';

export const dynamic = 'force-dynamic';

const ORIGIN = process.env.NEXT_PUBLIC_BASE_URL || 'https://scoopngoarizona.com';

// Staff = a logged-in session (the "Send card setup link" button) OR the
// CRON_SECRET (Bearer / x-cron-secret). Staff may act for any customer; the
// public portal path instead proves a matching portal_token.
async function isStaff(request: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get('authorization');
    const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : '';
    const header = request.headers.get('x-cron-secret') || '';
    if (bearer === secret || header === secret) return true;
  }
  try {
    return Boolean(await getCurrentUser());
  } catch {
    return false;
  }
}

// Resolves + authorizes the target customer. Returns null when not authorized
// or not found (caller turns that into 401/404 without leaking which).
async function resolveCustomer(
  customerId: string,
  token: string | undefined,
  staff: boolean
): Promise<Customer | null> {
  if (!customerId) return null;
  const { data } = await supabaseServer()
    .from('customers')
    .select('*')
    .eq('id', customerId)
    .maybeSingle();
  const customer = (data as Customer) ?? null;
  if (!customer) return null;
  if (staff) return customer;
  // Public path: require a matching portal_token.
  if (token && customer.portal_token && token === customer.portal_token) {
    return customer;
  }
  return null;
}

// Creates the Checkout session (and the Stripe customer if missing), persisting
// stripe_customer_id back to Supabase. Returns the hosted URL + the stripe id.
async function createSetupSession(
  customer: Customer,
  nameOverride?: string,
  emailOverride?: string
): Promise<{ url: string; stripe_customer_id: string }> {
  const sk = stripe();
  const sb = supabaseServer();

  const customerName =
    nameOverride || `${customer.first_name} ${customer.last_name}`.trim() || 'Customer';
  const customerEmail = emailOverride || customer.email || undefined;

  let stripeCustomerId = customer.stripe_customer_id;

  if (!stripeCustomerId) {
    const created = await sk.customers.create({
      name: customerName,
      ...(customerEmail ? { email: customerEmail } : {}),
      metadata: { supabase_id: customer.id },
    });
    stripeCustomerId = created.id;
    // Save stripe_customer_id back to Supabase.
    await sb
      .from('customers')
      .update({ stripe_customer_id: stripeCustomerId })
      .eq('id', customer.id);
  }

  const session = await sk.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: 'setup',
    payment_method_types: ['card'],
    success_url: `${ORIGIN}/payment-success?type=card_saved&name=${encodeURIComponent(
      customerName
    )}`,
    cancel_url: `${ORIGIN}/admin`,
    metadata: {
      customer_id: customer.id,
      customer_name: customerName,
      setup_for: 'card_on_file',
    },
    setup_intent_data: {
      metadata: {
        customer_id: customer.id,
        customer_name: customerName,
      },
    },
  });

  if (!session.url) throw new Error('Stripe did not return a Checkout URL');
  return { url: session.url, stripe_customer_id: stripeCustomerId };
}

export async function POST(request: Request) {
  let body: {
    customer_id?: string;
    token?: string;
    customer_name?: string;
    customer_email?: string;
    stripe_customer_id?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const customerId = body.customer_id;
  if (!customerId) {
    return NextResponse.json({ error: 'Missing customer_id' }, { status: 400 });
  }

  const staff = await isStaff(request);
  const customer = await resolveCustomer(customerId, body.token, staff);
  if (!customer) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await createSetupSession(
      customer,
      body.customer_name,
      body.customer_email
    );
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Stripe error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const customerId = searchParams.get('customer_id') || '';
  const token = searchParams.get('token') || undefined;

  const staff = await isStaff(request);
  const customer = await resolveCustomer(customerId, token, staff);
  if (!customer) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { url } = await createSetupSession(customer);
    return NextResponse.redirect(url, 303);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Stripe error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
