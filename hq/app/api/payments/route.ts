// Record a payment collected outside the app (Apple Pay, cash, Venmo, Zelle,
// check) for a specific service week, creating the invoice if it never made it
// onto the books. This is the one-tap version of the manual backfills we kept
// having to script.
//
//   POST /api/payments
//     { customer_id, period_start (YYYY-MM-DD, the week's Monday),
//       amount?, method?, notes? }
//   -> 200 { ok, invoice_id, created } created=true when a new invoice was made
//   -> 409 when that week is already paid
//
// Staff session only (middleware gates this too).

import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/auth';
import { weekFromPeriodStart, dueDateFor } from '@/lib/charge-core';
import type { Customer, Invoice, PayMethod } from '@/lib/types';

export const dynamic = 'force-dynamic';

const METHODS: PayMethod[] = ['cash', 'venmo', 'zelle', 'check', 'card', 'applepay'];

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
    period_start?: string;
    amount?: number;
    method?: string;
    notes?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const customerId = body.customer_id;
  const periodStart = body.period_start;
  if (!customerId || !periodStart || !/^\d{4}-\d{2}-\d{2}$/.test(periodStart)) {
    return NextResponse.json(
      { error: 'customer_id and period_start (YYYY-MM-DD) are required' },
      { status: 400 }
    );
  }
  const method = (METHODS.includes(body.method as PayMethod)
    ? body.method
    : 'cash') as PayMethod;

  try {
    const sb = supabaseServer();
    const { data: custData } = await sb
      .from('customers')
      .select('*')
      .eq('id', customerId)
      .maybeSingle();
    const customer = custData as Customer | null;
    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    const week = weekFromPeriodStart(periodStart);
    const amount =
      Number.isFinite(Number(body.amount)) && Number(body.amount) > 0
        ? Math.round(Number(body.amount) * 100) / 100
        : Number(customer.price_per_visit) || 0;
    if (!amount) {
      return NextResponse.json(
        { error: 'No amount given and the client has no standing price' },
        { status: 400 }
      );
    }

    // Existing invoice for the week? Pay it; already paid is a conflict.
    const { data: invData } = await sb
      .from('invoices')
      .select('*')
      .eq('customer_id', customerId)
      .eq('period_start', week.periodStart)
      .limit(1);
    const existing = ((invData ?? []) as Invoice[])[0];

    let invoiceId: string;
    let created = false;
    if (existing) {
      if (existing.status === 'paid') {
        return NextResponse.json(
          { error: `Week of ${week.weekLabel} is already paid` },
          { status: 409 }
        );
      }
      await sb
        .from('invoices')
        .update({
          status: 'paid',
          amount,
          notes: `Week of ${week.weekLabel}, paid via ${method} (recorded in HQ)`,
        })
        .eq('id', existing.id);
      invoiceId = existing.id;
    } else {
      const { data: ins, error } = await sb
        .from('invoices')
        .insert({
          customer_id: customerId,
          amount,
          status: 'paid',
          due_date: dueDateFor(customer, week),
          period_start: week.periodStart,
          period_end: week.periodEnd,
          notes: `Week of ${week.weekLabel}, paid via ${method} (recorded in HQ)`,
        })
        .select('id')
        .single();
      if (error) throw error;
      invoiceId = (ins as { id: string }).id;
      created = true;
    }

    await sb.from('payments').insert({
      invoice_id: invoiceId,
      amount,
      method,
      paid_at: new Date().toISOString(),
      notes: body.notes || `Recorded in HQ (${method})`,
    });

    return NextResponse.json({ ok: true, invoice_id: invoiceId, created });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to record payment';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
