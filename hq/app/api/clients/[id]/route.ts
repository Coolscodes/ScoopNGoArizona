// Workstream 3 — Clients API (single record).
//   GET    /api/clients/:id  -> 200 { client, dogs }
//   PATCH  /api/clients/:id  { ...fields } -> 200 { client }
//   DELETE /api/clients/:id  -> 200 { ok }  (soft archive: active=false — preserves history)

import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import type { Customer, Dog } from '@/lib/types';

export const dynamic = 'force-dynamic';

const EDITABLE: (keyof Customer)[] = [
  'first_name', 'last_name', 'phone', 'email', 'address', 'city', 'zip',
  'gate_code', 'yard_notes', 'service_type', 'preferred_day', 'price_per_visit',
  'active', 'frequency_weeks', 'start_date', 'next_visit_date', 'flags', 'route_order',
];

function pick(body: Record<string, unknown>): Partial<Customer> {
  const out: Record<string, unknown> = {};
  for (const k of EDITABLE) {
    if (body[k] !== undefined) out[k] = body[k] === '' ? null : body[k];
  }
  return out as Partial<Customer>;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const sb = supabaseServer();
    const [{ data: client, error: e1 }, { data: dogs, error: e2 }] = await Promise.all([
      sb.from('customers').select('*').eq('id', params.id).single(),
      sb.from('dogs').select('*').eq('customer_id', params.id).order('name'),
    ]);
    if (e1) throw e1;
    if (e2) throw e2;
    return NextResponse.json({ client: client as Customer, dogs: (dogs ?? []) as Dog[] });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load client';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  try {
    const { data, error } = await supabaseServer()
      .from('customers')
      .update(pick(body))
      .eq('id', params.id)
      .select('*')
      .single();
    if (error) throw error;
    return NextResponse.json({ client: data as Customer });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update client';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const { error } = await supabaseServer()
      .from('customers')
      .update({ active: false })
      .eq('id', params.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to archive client';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
