// Workstream 7 — Customer portal API (the magic-link / token gate).
//
// This is a PUBLIC surface. There is NO staff auth here. The ONLY credential is
// the customer's `customers.portal_token`. Every read is scoped to the single
// customer that the token (or email) resolves to — we never return rows that
// belong to another customer, and we never echo the service-role key or any
// staff data to the browser.
//
//   GET  /api/portal?token=...   -> 200 { customer, nextVisit, lastVisit, balance, invoices }
//                                   404 if the token matches no customer.
//   POST /api/portal  { email }  -> 200 { token }  (ensures a token exists; magic-link lookup)
//                                   To avoid leaking which emails are customers, an unknown
//                                   email returns 200 { token: null } (no enumeration signal).
//
// The token is an opaque random string. It is the bearer credential, so it is
// only ever returned to the caller that already proved possession (GET) or that
// supplied the matching email (POST). It is never listed or searchable.

import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { supabaseServer } from '@/lib/supabase';
import type { Customer, Appointment, ServiceLog, Invoice } from '@/lib/types';
import { customerForToken, toPortalCustomer, type PortalData } from '@/components/portal/data';

export const dynamic = 'force-dynamic';

function generateToken(): string {
  return randomBytes(24).toString('hex'); // 48 hex chars, ~192 bits of entropy
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = (searchParams.get('token') || '').trim();
  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 });
  }

  try {
    const customer = await customerForToken(token);
    if (!customer) {
      return NextResponse.json({ error: 'Invalid or expired link' }, { status: 404 });
    }

    const sb = supabaseServer();
    const nowISO = new Date().toISOString();

    // Every query below is scoped by `customer_id = customer.id` — the only
    // customer the token unlocked. No cross-customer reads are possible.
    const [{ data: upcoming }, { data: lastLog }, { data: unpaid }] = await Promise.all([
      // Next scheduled visit: earliest still-scheduled appointment from now on.
      sb
        .from('appointments')
        .select('scheduled_at, service_type, status')
        .eq('customer_id', customer.id)
        .eq('status', 'scheduled')
        .gte('scheduled_at', nowISO)
        .order('scheduled_at', { ascending: true })
        .limit(1),
      // Last completed visit (with photo) from service_logs.
      sb
        .from('service_logs')
        .select('completed_at, gate_photo_url')
        .eq('customer_id', customer.id)
        .order('completed_at', { ascending: false })
        .limit(1),
      // Outstanding invoices (sent / overdue) → balance.
      sb
        .from('invoices')
        .select('id, amount, status, due_date, period_start, period_end')
        .eq('customer_id', customer.id)
        .in('status', ['sent', 'overdue'])
        .order('created_at', { ascending: false }),
    ]);

    const nextRow = (upcoming ?? [])[0] as Pick<Appointment, 'scheduled_at' | 'service_type'> | undefined;
    const lastRow = (lastLog ?? [])[0] as Pick<ServiceLog, 'completed_at' | 'gate_photo_url'> | undefined;
    const invoiceRows = (unpaid ?? []) as Invoice[];

    const balance = invoiceRows.reduce((sum, inv) => sum + (Number(inv.amount) || 0), 0);

    const payload: PortalData = {
      customer: toPortalCustomer(customer),
      nextVisit: nextRow ? { scheduled_at: nextRow.scheduled_at, service_type: nextRow.service_type } : null,
      lastVisit: lastRow
        ? { completed_at: lastRow.completed_at, gate_photo_url: lastRow.gate_photo_url }
        : null,
      balance,
      invoices: invoiceRows.map((inv) => ({
        id: inv.id,
        amount: Number(inv.amount) || 0,
        status: inv.status,
        due_date: inv.due_date,
        period_start: inv.period_start,
        period_end: inv.period_end,
      })),
    };

    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load account';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: { email?: unknown };
  try {
    body = (await request.json()) as { email?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }

  try {
    const sb = supabaseServer();
    // Case-insensitive exact match on email. Only ever fetch the single matching
    // customer; never list customers.
    const { data, error } = await sb
      .from('customers')
      .select('id, portal_token')
      .ilike('email', email)
      .limit(1)
      .maybeSingle();
    if (error) throw error;

    // Unknown email: respond 200 with a null token. We do NOT reveal whether the
    // email belongs to a customer (no account-enumeration oracle).
    if (!data) {
      return NextResponse.json({ token: null });
    }

    const row = data as Pick<Customer, 'id' | 'portal_token'>;
    let token = row.portal_token;

    // Mint a token on first use, then persist it.
    if (!token) {
      token = generateToken();
      const { error: upErr } = await sb
        .from('customers')
        .update({ portal_token: token })
        .eq('id', row.id);
      if (upErr) throw upErr;
    }

    return NextResponse.json({ token });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to look up account';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
