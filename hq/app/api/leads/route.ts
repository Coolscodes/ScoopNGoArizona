// Workstream 4, Leads API (collection).
//   GET   /api/leads?status=          -> 200 { leads: Lead[] }
//   PATCH /api/leads                   -> update status OR convert-to-client
//     { id, status }                   -> 200 { lead }            (status update)
//     { id, action: 'convert' }        -> 200 { lead, customer }  (creates a customer)

import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import type { Lead, Customer, LeadStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';

const STATUSES: LeadStatus[] = ['new', 'contacted', 'converted', 'lost'];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = (searchParams.get('status') || '').trim();
  try {
    const sb = supabaseServer();
    let query = sb.from('leads').select('*').order('created_at', { ascending: false });
    if (status && STATUSES.includes(status as LeadStatus)) {
      query = query.eq('status', status);
    }
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ leads: (data ?? []) as Lead[] });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load leads';
    return NextResponse.json({ error: message, leads: [] }, { status: 500 });
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

  // Load the lead first (needed for both paths).
  const { data: leadRow, error: loadErr } = await sb
    .from('leads')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (loadErr) {
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  }
  if (!leadRow) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
  }
  const lead = leadRow as Lead;

  // --- Convert to client -------------------------------------------------
  if (body.action === 'convert') {
    try {
      // Reuse an already-linked customer if one exists (idempotent).
      const { data: existing } = await sb
        .from('customers')
        .select('*')
        .eq('lead_id', id)
        .maybeSingle();

      let customer = existing as Customer | null;
      if (!customer) {
        const { data: inserted, error: insErr } = await sb
          .from('customers')
          .insert({
            lead_id: lead.id,
            first_name: lead.first_name,
            last_name: lead.last_name,
            phone: lead.phone,
            email: lead.email,
            zip: lead.zip,
            service_type: normalizeServiceType(lead.service_type),
            active: true,
          })
          .select('*')
          .single();
        if (insErr) throw insErr;
        customer = inserted as Customer;
      }

      const { data: updatedLead, error: updErr } = await sb
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', id)
        .select('*')
        .single();
      if (updErr) throw updErr;

      return NextResponse.json({ lead: updatedLead as Lead, customer });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to convert lead';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // --- Status update -----------------------------------------------------
  const status = typeof body.status === 'string' ? body.status : '';
  if (!STATUSES.includes(status as LeadStatus)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }
  try {
    const { data, error } = await sb
      .from('leads')
      .update({ status })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return NextResponse.json({ lead: data as Lead });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update lead';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Map a free-text lead service_type onto the customer ServiceType enum where possible.
function normalizeServiceType(raw?: string): Customer['service_type'] {
  const s = (raw ?? '').toLowerCase();
  if (s.includes('bi') || s.includes('every other')) return 'Bi-Weekly';
  if (s.includes('one') || s.includes('once') || s.includes('single')) return 'One-Time';
  if (s.includes('week')) return 'Weekly';
  return undefined;
}
