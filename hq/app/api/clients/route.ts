// Workstream 3, Clients API (collection).
//   GET  /api/clients?search=         -> 200 { clients: Customer[] }
//   POST /api/clients   { ...customer } -> 201 { client: Customer }

import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import type { Customer } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Fields a caller is allowed to set on a customer.
const EDITABLE: (keyof Customer)[] = [
  'first_name', 'last_name', 'phone', 'email', 'address', 'city', 'zip',
  'gate_code', 'yard_notes', 'service_type', 'preferred_day', 'price_per_visit',
  'active', 'auto_charge', 'frequency_weeks', 'start_date', 'next_visit_date',
];

function pick(body: Record<string, unknown>): Partial<Customer> {
  const out: Record<string, unknown> = {};
  for (const k of EDITABLE) {
    if (body[k] !== undefined) out[k] = body[k] === '' ? null : body[k];
  }
  return out as Partial<Customer>;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const search = (searchParams.get('search') || '').trim();
  try {
    const sb = supabaseServer();
    let query = sb.from('customers').select('*').order('first_name', { ascending: true });
    if (search) {
      query = query.or(
        `first_name.ilike.%${search}%,last_name.ilike.%${search}%,address.ilike.%${search}%,phone.ilike.%${search}%`
      );
    }
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ clients: (data ?? []) as Customer[] });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load clients';
    return NextResponse.json({ error: message, clients: [] }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const payload = pick(body);
  if (!payload.first_name) {
    return NextResponse.json({ error: 'first_name is required' }, { status: 400 });
  }
  if (payload.active === undefined) payload.active = true;

  try {
    const { data, error } = await supabaseServer()
      .from('customers')
      .insert(payload)
      .select('*')
      .single();
    if (error) throw error;
    return NextResponse.json({ client: data as Customer }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create client';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
