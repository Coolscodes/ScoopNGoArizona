// Workstream 4 — Quotes API (collection).
//   GET   /api/quotes?status=                     -> 200 { quotes: Quote[] }
//   POST  /api/quotes   { lead_id?, customer_id?, line_items?, notes? }
//                                                  -> 201 { quote }  (status 'draft')
//   PATCH /api/quotes   { id, ...fields }          -> 200 { quote }
//     Setting status='sent' ensures a public_token (crypto.randomUUID()).

import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import type { Quote, QuoteLineItem, QuoteStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';

const STATUSES: QuoteStatus[] = ['draft', 'sent', 'approved', 'declined'];

// Coerce an unknown value into a clean QuoteLineItem[] and compute the subtotal
// of the non-recurring (one-time) items.
function normalizeLineItems(raw: unknown): { items: QuoteLineItem[]; subtotal: number } {
  const items: QuoteLineItem[] = [];
  let subtotal = 0;
  if (Array.isArray(raw)) {
    for (const r of raw) {
      if (!r || typeof r !== 'object') continue;
      const rec = r as Record<string, unknown>;
      const label = typeof rec.label === 'string' ? rec.label : '';
      const amount = Number(rec.amount);
      if (!label && !amount) continue;
      const recurring = Boolean(rec.recurring);
      const item: QuoteLineItem = { label, amount: Number.isFinite(amount) ? amount : 0 };
      if (recurring) item.recurring = true;
      items.push(item);
      if (!recurring) subtotal += item.amount;
    }
  }
  return { items, subtotal: Math.round(subtotal * 100) / 100 };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = (searchParams.get('status') || '').trim();
  try {
    const sb = supabaseServer();
    let query = sb.from('quotes').select('*').order('created_at', { ascending: false });
    if (status && STATUSES.includes(status as QuoteStatus)) {
      query = query.eq('status', status);
    }
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ quotes: (data ?? []) as Quote[] });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load quotes';
    return NextResponse.json({ error: message, quotes: [] }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { items, subtotal } = normalizeLineItems(body.line_items);
  const payload: Record<string, unknown> = {
    lead_id: typeof body.lead_id === 'string' && body.lead_id ? body.lead_id : null,
    customer_id: typeof body.customer_id === 'string' && body.customer_id ? body.customer_id : null,
    line_items: items,
    subtotal,
    recurring_amount:
      body.recurring_amount === undefined || body.recurring_amount === ''
        ? null
        : Number(body.recurring_amount),
    recurring_interval:
      typeof body.recurring_interval === 'string' && body.recurring_interval
        ? body.recurring_interval
        : null,
    notes: typeof body.notes === 'string' && body.notes ? body.notes : null,
    status: 'draft',
    public_token: crypto.randomUUID(),
  };

  try {
    const { data, error } = await supabaseServer()
      .from('quotes')
      .insert(payload)
      .select('*')
      .single();
    if (error) throw error;
    return NextResponse.json({ quote: data as Quote }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create quote';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const sb = supabaseServer();
  const update: Record<string, unknown> = {};

  if (body.line_items !== undefined) {
    const { items, subtotal } = normalizeLineItems(body.line_items);
    update.line_items = items;
    update.subtotal = subtotal;
  }
  if (body.recurring_amount !== undefined) {
    update.recurring_amount =
      body.recurring_amount === '' || body.recurring_amount === null
        ? null
        : Number(body.recurring_amount);
  }
  if (body.recurring_interval !== undefined) {
    update.recurring_interval = body.recurring_interval || null;
  }
  if (body.notes !== undefined) {
    update.notes = body.notes || null;
  }
  if (body.customer_id !== undefined) {
    update.customer_id = body.customer_id || null;
  }
  if (body.lead_id !== undefined) {
    update.lead_id = body.lead_id || null;
  }

  if (body.status !== undefined) {
    const status = String(body.status);
    if (!STATUSES.includes(status as QuoteStatus)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }
    update.status = status;
    // Sending a quote must guarantee a shareable token.
    if (status === 'sent') {
      const { data: current } = await sb
        .from('quotes')
        .select('public_token')
        .eq('id', id)
        .maybeSingle();
      if (!current?.public_token) {
        update.public_token = crypto.randomUUID();
      }
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  try {
    const { data, error } = await sb
      .from('quotes')
      .update(update)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return NextResponse.json({ quote: data as Quote });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update quote';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
