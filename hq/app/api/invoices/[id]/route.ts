// Per-invoice actions (staff). Session-gated by middleware; re-checked here.
//
//   PATCH /api/invoices/:id
//     { action: 'mark_paid', method?: 'cash'|'venmo'|'zelle'|'check'|'card' }
//        -> mark the invoice paid and record a payment (for money collected
//           outside the app, cash, Venmo, Zelle, check, etc.)
//     { action: 'charge' }
//        -> charge the customer's card on file for the invoice amount via Stripe,
//           then mark it paid and record a card payment.

import { NextResponse } from 'next/server';
import { stripe, dollarsToCents } from '@/lib/stripe';
import { supabaseServer } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/auth';
import type { Customer, Invoice, PayMethod } from '@/lib/types';

export const dynamic = 'force-dynamic';

const METHODS: PayMethod[] = ['cash', 'venmo', 'zelle', 'check', 'card'];

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  // Defense in depth (middleware also gates this), return clean 401 JSON.
  try {
    if (!(await getCurrentUser())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { action?: string; method?: string };
  try {
    body = (await request.json()) as { action?: string; method?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const sb = supabaseServer();
  const { data: invData, error: invErr } = await sb
    .from('invoices')
    .select('*')
    .eq('id', params.id)
    .single();
  if (invErr || !invData) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  }
  const invoice = invData as Invoice;

  if (invoice.status === 'paid') {
    return NextResponse.json({ ok: true, alreadyPaid: true });
  }

  // ---- mark paid (payment collected outside the app) ----
  if (body.action === 'mark_paid') {
    const method = (METHODS.includes(body.method as PayMethod)
      ? (body.method as PayMethod)
      : 'cash') as PayMethod;
    try {
      await sb
        .from('invoices')
        .update({ status: 'paid', notes: `Marked paid (${method}) in HQ` })
        .eq('id', invoice.id);
      await sb.from('payments').insert({
        invoice_id: invoice.id,
        amount: invoice.amount,
        method,
        paid_at: new Date().toISOString(),
        notes: 'Marked paid in HQ',
      });
      return NextResponse.json({ ok: true, status: 'paid', method });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to mark paid';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // ---- charge the card on file for this invoice ----
  if (body.action === 'charge') {
    const { data: custData } = await sb
      .from('customers')
      .select('*')
      .eq('id', invoice.customer_id)
      .single();
    const customer = custData as Customer | null;
    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }
    if (!customer.stripe_customer_id) {
      return NextResponse.json(
        { error: 'No card on file, send a card setup link first.' },
        { status: 400 }
      );
    }

    try {
      const sk = stripe();
      // Default payment method, falling back to the first card on the customer.
      const stripeCust = await sk.customers.retrieve(customer.stripe_customer_id);
      let pmId: string | undefined;
      if (!('deleted' in stripeCust)) {
        const dpm = stripeCust.invoice_settings?.default_payment_method;
        pmId = typeof dpm === 'string' ? dpm : dpm?.id;
      }
      if (!pmId) {
        const pms = await sk.paymentMethods.list({
          customer: customer.stripe_customer_id,
          type: 'card',
        });
        pmId = pms.data[0]?.id;
      }
      if (!pmId) {
        return NextResponse.json(
          { error: 'No payment method found, send a card setup link.' },
          { status: 400 }
        );
      }

      const pi = await sk.paymentIntents.create({
        amount: dollarsToCents(invoice.amount),
        currency: 'usd',
        customer: customer.stripe_customer_id,
        payment_method: pmId,
        confirm: true,
        off_session: true,
        description: `Scoop N Go Arizona invoice ${invoice.id}`,
        metadata: { customer_id: customer.id, invoice_id: invoice.id },
      });

      if (pi.status !== 'succeeded') {
        return NextResponse.json(
          { error: `Card declined or needs action (${pi.status}).` },
          { status: 402 }
        );
      }

      await sb
        .from('invoices')
        .update({ status: 'paid', stripe_payment_intent_id: pi.id, notes: 'Charged card on file in HQ' })
        .eq('id', invoice.id);
      await sb.from('payments').insert({
        invoice_id: invoice.id,
        amount: invoice.amount,
        method: 'card',
        paid_at: new Date().toISOString(),
        notes: `Stripe ${pi.id}`,
      });

      return NextResponse.json({ ok: true, status: 'paid', charged: invoice.amount });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Charge failed';
      return NextResponse.json({ error: message }, { status: 402 });
    }
  }

  return NextResponse.json({ error: "Unknown action. Use 'mark_paid' or 'charge'." }, { status: 400 });
}
