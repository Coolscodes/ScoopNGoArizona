// Workstream 6, Manual / weekly auto-charge.
// The charging core (PaymentIntent, invoice upsert, payments row, receipt and
// failure emails, AR record on decline) lives in lib/charge-core.ts, shared
// with the charge-on-completion hooks in /api/route and /api/visits.
//
// Auth: CRON_SECRET (Bearer or x-cron-secret; used by Vercel cron) OR a
// logged-in staff session (the Charge Clients modal). Fail closed if
// CRON_SECRET is unset.

import { NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { supabaseServer } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/auth';
import {
  currentWeek,
  chargeCustomerForWeek,
  type ChargeResult,
} from '@/lib/charge-core';
import type { Customer } from '@/lib/types';

export const dynamic = 'force-dynamic';

// --- auth ------------------------------------------------------------------

function hasCronSecret(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed if unset
  const auth = request.headers.get('authorization');
  const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : '';
  const header = request.headers.get('x-cron-secret') || '';
  return bearer === secret || header === secret;
}

async function authorized(request: Request): Promise<boolean> {
  if (hasCronSecret(request)) return true;
  try {
    return Boolean(await getCurrentUser());
  } catch {
    return false;
  }
}

// --- handler ----------------------------------------------------------------

export async function POST(request: Request) {
  if (!(await authorized(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { customer_ids?: unknown; amounts?: unknown } = {};
  try {
    body = (await request.json()) as { customer_ids?: unknown; amounts?: unknown };
  } catch {
    // Empty body is allowed below; treated as no selection.
  }

  const customerIds = Array.isArray(body.customer_ids)
    ? (body.customer_ids as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];

  // Optional per-client amount overrides from the Charge Clients modal. Only
  // values >= $1 are honored; anything else falls back to price_per_visit.
  const overrides = new Map<string, number>();
  if (body.amounts && typeof body.amounts === 'object' && !Array.isArray(body.amounts)) {
    for (const [id, v] of Object.entries(body.amounts as Record<string, unknown>)) {
      const n = typeof v === 'number' ? v : parseFloat(String(v));
      if (!Number.isNaN(n) && n >= 1) overrides.set(id, Math.round(n * 100) / 100);
    }
  }

  const week = currentWeek();

  if (!customerIds.length) {
    return NextResponse.json({ error: 'No customers selected' }, { status: 400 });
  }

  const sb = supabaseServer();
  const sk = stripe();

  // Fetch only the selected customers.
  const { data: custData } = await sb
    .from('customers')
    .select('*')
    .in('id', customerIds)
    .order('first_name', { ascending: true });
  const customers = (custData ?? []) as Customer[];

  if (!customers.length) {
    return NextResponse.json({
      message: 'No customers found',
      week: week.weekLabel,
      results: [],
    });
  }

  // Only skip if already PAID this week, don't skip "sent" invoices.
  const { data: paidData } = await sb
    .from('invoices')
    .select('customer_id')
    .eq('period_start', week.periodStart)
    .eq('status', 'paid');
  const alreadyPaid = new Set(
    ((paidData ?? []) as { customer_id: string }[]).map((i) => i.customer_id)
  );

  const results: ChargeResult[] = [];

  for (const c of customers) {
    const name = `${c.first_name} ${c.last_name}`.trim();

    if (alreadyPaid.has(c.id)) {
      results.push({ name, status: 'skipped', reason: 'Already charged this week' });
      continue;
    }

    const chargeAmount = overrides.get(c.id) ?? c.price_per_visit ?? 0;
    if (!chargeAmount) {
      results.push({ name, status: 'skipped', reason: 'No price set' });
      continue;
    }
    if (!c.stripe_customer_id) {
      results.push({ name, status: 'skipped', reason: 'No card on file' });
      continue;
    }

    results.push(await chargeCustomerForWeek(sb, sk, c, week, chargeAmount));
  }

  const charged = results.filter((r) => r.status === 'charged').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  const total = results
    .filter((r): r is Extract<ChargeResult, { status: 'charged' }> => r.status === 'charged')
    .reduce((s, r) => s + (r.amount || 0), 0);

  return NextResponse.json({
    week: week.weekLabel,
    charged,
    failed,
    skipped,
    total,
    results,
  });
}

// GET /api/charge, eligibility preview for the Charge Clients modal.
// Returns every active client with the state needed for an accurate run:
// price, card on file, whether this week is already paid, and any open
// (sent/overdue) invoice amount for the week (used to pre-fill amounts).
export async function GET(request: Request) {
  if (!(await authorized(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const week = currentWeek();
  const sb = supabaseServer();

  const { data: custData } = await sb
    .from('customers')
    .select('*')
    .eq('active', true)
    .order('first_name', { ascending: true });
  const customers = (custData ?? []) as Customer[];

  const { data: invData } = await sb
    .from('invoices')
    .select('customer_id, amount, status')
    .eq('period_start', week.periodStart);
  const weekInvoices = (invData ?? []) as {
    customer_id: string;
    amount: number;
    status: string;
  }[];

  const paid = new Set(
    weekInvoices.filter((i) => i.status === 'paid').map((i) => i.customer_id)
  );
  const openAmount = new Map<string, number>();
  for (const i of weekInvoices) {
    if (i.status === 'sent' || i.status === 'overdue') {
      openAmount.set(
        i.customer_id,
        (openAmount.get(i.customer_id) ?? 0) + (Number(i.amount) || 0)
      );
    }
  }

  return NextResponse.json({
    week: {
      label: week.weekLabel,
      periodStart: week.periodStart,
      periodEnd: week.periodEnd,
    },
    clients: customers.map((c) => ({
      id: c.id,
      name: `${c.first_name} ${c.last_name}`.trim(),
      serviceType: c.service_type ?? null,
      preferredDay: c.preferred_day ?? null,
      price: c.price_per_visit ?? null,
      hasCard: Boolean(c.stripe_customer_id),
      stripeCustomerId: c.stripe_customer_id ?? null,
      email: c.email ?? null,
      paidThisWeek: paid.has(c.id),
      openThisWeek: openAmount.get(c.id) ?? null,
      autoCharge: Boolean(c.auto_charge),
    })),
  });
}
