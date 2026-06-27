// Workstream 4 — PUBLIC quote API (by public_token). No auth.
//   GET  /api/quotes/:token                 -> 200 { quote }  (token-scoped only)
//   POST /api/quotes/:token  { action }      -> approve | decline
//     approve  -> ensures a customers row (from the linked lead, else quote notes/customer),
//                 sets status='approved', approved_at=now -> 200 { quote, customer }
//     decline  -> sets status='declined'                  -> 200 { quote }
//
// SECURITY: this handler is reachable without a session. It only ever reads/writes the
// single quote matched by the opaque token and the customer it converts to. It never
// exposes the service-role key (runs server-side) and never returns unrelated rows.

import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import type { Quote, Lead, Customer } from '@/lib/types';

export const dynamic = 'force-dynamic';

async function loadQuote(token: string): Promise<Quote | null> {
  const { data } = await supabaseServer()
    .from('quotes')
    .select('*')
    .eq('public_token', token)
    .maybeSingle();
  return (data as Quote) ?? null;
}

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  if (!params.token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 });
  }
  try {
    const quote = await loadQuote(params.token);
    if (!quote) {
      return NextResponse.json({ error: 'Quote not found' }, { status: 404 });
    }
    return NextResponse.json({ quote });
  } catch {
    return NextResponse.json({ error: 'Failed to load quote' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: { token: string } }) {
  if (!params.token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const action = body.action;
  if (action !== 'approve' && action !== 'decline') {
    return NextResponse.json({ error: "action must be 'approve' or 'decline'" }, { status: 400 });
  }

  const sb = supabaseServer();
  const quote = await loadQuote(params.token);
  if (!quote) {
    return NextResponse.json({ error: 'Quote not found' }, { status: 404 });
  }

  // Already resolved — return current state idempotently.
  if (quote.status === 'approved' || quote.status === 'declined') {
    return NextResponse.json({ quote, alreadyResolved: true });
  }

  // --- Decline -----------------------------------------------------------
  if (action === 'decline') {
    try {
      const { data, error } = await sb
        .from('quotes')
        .update({ status: 'declined' })
        .eq('public_token', params.token)
        .select('*')
        .single();
      if (error) throw error;
      return NextResponse.json({ quote: data as Quote });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to decline quote';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // --- Approve -> ensure a customer, then mark approved -------------------
  try {
    let customer: Customer | null = null;

    // 1) Already linked to a customer?
    if (quote.customer_id) {
      const { data } = await sb
        .from('customers')
        .select('*')
        .eq('id', quote.customer_id)
        .maybeSingle();
      customer = (data as Customer) ?? null;
    }

    // 2) Otherwise build one from the linked lead.
    if (!customer && quote.lead_id) {
      const { data: leadRow } = await sb
        .from('leads')
        .select('*')
        .eq('id', quote.lead_id)
        .maybeSingle();
      const lead = (leadRow as Lead) ?? null;
      if (lead) {
        // Reuse a customer already converted from this lead, if any.
        const { data: existing } = await sb
          .from('customers')
          .select('*')
          .eq('lead_id', lead.id)
          .maybeSingle();
        if (existing) {
          customer = existing as Customer;
        } else {
          const { data: inserted, error: insErr } = await sb
            .from('customers')
            .insert({
              lead_id: lead.id,
              first_name: lead.first_name,
              last_name: lead.last_name,
              phone: lead.phone,
              email: lead.email,
              zip: lead.zip,
              service_type: recurringToServiceType(quote.recurring_interval),
              price_per_visit: quote.recurring_amount ?? null,
              active: true,
            })
            .select('*')
            .single();
          if (insErr) throw insErr;
          customer = inserted as Customer;
        }
        // Mark the lead converted.
        await sb.from('leads').update({ status: 'converted' }).eq('id', lead.id);
      }
    }

    // 3) Last resort: a minimal customer from the quote notes (name only).
    if (!customer) {
      const name = parseNameFromNotes(quote.notes);
      const { data: inserted, error: insErr } = await sb
        .from('customers')
        .insert({
          first_name: name.first || 'New',
          last_name: name.last || 'Client',
          phone: '',
          email: '',
          service_type: recurringToServiceType(quote.recurring_interval),
          price_per_visit: quote.recurring_amount ?? null,
          active: true,
        })
        .select('*')
        .single();
      if (insErr) throw insErr;
      customer = inserted as Customer;
    }

    const { data: updatedQuote, error: updErr } = await sb
      .from('quotes')
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),
        customer_id: customer.id,
      })
      .eq('public_token', params.token)
      .select('*')
      .single();
    if (updErr) throw updErr;

    return NextResponse.json({ quote: updatedQuote as Quote, customer });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to approve quote';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function recurringToServiceType(interval?: string): Customer['service_type'] {
  const s = (interval ?? '').toLowerCase();
  if (!s) return undefined;
  if (s.includes('bi') || s.includes('every other') || s.includes('2')) return 'Bi-Weekly';
  if (s.includes('week')) return 'Weekly';
  if (s.includes('one') || s.includes('once')) return 'One-Time';
  return undefined;
}

// Notes may carry a "Name: First Last" hint when there's no lead/customer.
function parseNameFromNotes(notes?: string): { first: string; last: string } {
  if (!notes) return { first: '', last: '' };
  const match = notes.match(/name\s*[:\-]\s*([^\n,;]+)/i);
  const raw = (match ? match[1] : '').trim();
  if (!raw) return { first: '', last: '' };
  const parts = raw.split(/\s+/);
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') };
}
