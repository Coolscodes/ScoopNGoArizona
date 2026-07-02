// Server-only tool executors for the Scoop HQ AI assistant.
//
// SAFETY: every function here is READ-ONLY against the database. No inserts,
// updates, or deletes. No Stripe calls. No SMS/email is ever sent — draft_sms
// only returns instructions telling the model to write a draft in its reply
// for a human to review and send manually.

import { supabaseServer } from '@/lib/supabase';
import { getBusinessSnapshot } from '@/lib/ai';
import { fullName } from '@/lib/format';

function daysSince(iso?: string | null): number {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

// get_business_snapshot: compact overview of the whole business, already
// assembled by the frozen AI foundation.
export async function get_business_snapshot(): Promise<string> {
  const snapshot = await getBusinessSnapshot();
  return JSON.stringify(snapshot);
}

// search_clients({ query }): fuzzy match against name/phone/email, active
// clients surfaced first, capped at 8 results.
export async function search_clients(args: { query?: string }): Promise<string> {
  const query = (args?.query ?? '').trim();
  const db = supabaseServer();

  let q = db
    .from('customers')
    .select(
      'id, first_name, last_name, phone, email, address, service_type, preferred_day, price_per_visit, flags, active'
    )
    .order('active', { ascending: false })
    .limit(8);

  if (query) {
    // Tokenize so full names work: "Lisa Fotu" matches first_name~Lisa OR
    // last_name~Fotu. Sanitize tokens to avoid breaking the or() syntax.
    const tokens = query
      .split(/\s+/)
      .map((t) => t.replace(/[,()%]/g, ''))
      .filter(Boolean)
      .slice(0, 4);
    const ors = tokens.flatMap((t) => [
      `first_name.ilike.%${t}%`,
      `last_name.ilike.%${t}%`,
      `phone.ilike.%${t}%`,
      `email.ilike.%${t}%`,
    ]);
    if (ors.length > 0) q = q.or(ors.join(','));
  }

  const { data, error } = await q;
  if (error) return JSON.stringify({ error: error.message, results: [] });

  const results = (data ?? []).map((c) => ({
    id: c.id,
    name: fullName(c),
    phone: c.phone,
    address: c.address,
    service_type: c.service_type,
    preferred_day: c.preferred_day,
    price_per_visit: c.price_per_visit,
    flags: c.flags ?? [],
    active: c.active,
  }));

  return JSON.stringify({ results });
}

// get_client_details({ client_id }): full picture of one client — profile,
// dogs, recent service history, recent invoices, and lifetime paid total.
export async function get_client_details(args: { client_id?: string }): Promise<string> {
  const clientId = args?.client_id;
  if (!clientId) return JSON.stringify({ error: 'client_id is required' });

  const db = supabaseServer();

  const [customerRes, dogsRes, logsRes, invoicesRes] = await Promise.all([
    db.from('customers').select('*').eq('id', clientId).single(),
    db.from('dogs').select('name, breed, notes').eq('customer_id', clientId),
    db
      .from('service_logs')
      .select('completed_at, issue_flagged, issue_details, technician_notes')
      .eq('customer_id', clientId)
      .order('completed_at', { ascending: false })
      .limit(5),
    db
      .from('invoices')
      .select('id, amount, status, created_at, due_date')
      .eq('customer_id', clientId)
      .order('created_at', { ascending: false })
      .limit(5),
  ]);

  if (customerRes.error || !customerRes.data) {
    return JSON.stringify({ error: customerRes.error?.message ?? 'Client not found' });
  }

  const customer = customerRes.data;
  const invoiceIds = (invoicesRes.data ?? []).map((i) => i.id);

  let totalPaid = 0;
  if (invoiceIds.length > 0) {
    const { data: allInvoices } = await db
      .from('invoices')
      .select('id')
      .eq('customer_id', clientId);
    const allIds = (allInvoices ?? []).map((i) => i.id);
    if (allIds.length > 0) {
      const { data: payments } = await db
        .from('payments')
        .select('amount, invoice_id')
        .in('invoice_id', allIds);
      totalPaid = (payments ?? []).reduce((s, p) => s + (p.amount ?? 0), 0);
    }
  }

  return JSON.stringify({
    client: {
      id: customer.id,
      name: fullName(customer),
      phone: customer.phone,
      email: customer.email,
      address: customer.address,
      city: customer.city,
      zip: customer.zip,
      gate_code: customer.gate_code,
      yard_notes: customer.yard_notes,
      service_type: customer.service_type,
      preferred_day: customer.preferred_day,
      price_per_visit: customer.price_per_visit,
      active: customer.active,
      flags: customer.flags ?? [],
      next_visit_date: customer.next_visit_date,
    },
    dogs: dogsRes.data ?? [],
    recentServiceLogs: logsRes.data ?? [],
    recentInvoices: invoicesRes.data ?? [],
    totalPaidAllTime: totalPaid,
  });
}

// list_unpaid_invoices(): sent/overdue invoices, oldest first, capped at 20.
export async function list_unpaid_invoices(): Promise<string> {
  const db = supabaseServer();

  const { data, error } = await db
    .from('invoices')
    .select('id, customer_id, amount, status, due_date, created_at')
    .in('status', ['sent', 'overdue'])
    .order('created_at', { ascending: true })
    .limit(20);

  if (error) return JSON.stringify({ error: error.message, invoices: [] });

  const invoices = data ?? [];
  const customerIds = Array.from(new Set(invoices.map((i) => i.customer_id)));
  const byId = new Map<string, { first_name: string; last_name: string }>();
  if (customerIds.length > 0) {
    const { data: customers } = await db
      .from('customers')
      .select('id, first_name, last_name')
      .in('id', customerIds);
    for (const c of customers ?? []) byId.set(c.id, c);
  }

  const results = invoices.map((i) => ({
    invoice_id: i.id,
    customer: fullName(byId.get(i.customer_id)) || 'Unknown client',
    amount: i.amount,
    status: i.status,
    dueDate: i.due_date ?? undefined,
    daysOld: daysSince(i.created_at),
  }));

  return JSON.stringify({ invoices: results });
}

// list_leads({ status? }): the lead pipeline — who's interested, how long
// they've been waiting, and where they stand.
export async function list_leads(args: { status?: string }): Promise<string> {
  const db = supabaseServer();
  const VALID = ['new', 'contacted', 'converted', 'lost'];
  let q = db
    .from('leads')
    .select('id, first_name, last_name, phone, email, zip, dogs, service_type, status, notes, created_at')
    .order('created_at', { ascending: false })
    .limit(25);
  if (args?.status && VALID.includes(args.status)) q = q.eq('status', args.status);

  const { data, error } = await q;
  if (error) return JSON.stringify({ error: error.message, leads: [] });

  return JSON.stringify({
    leads: (data ?? []).map((l) => ({
      lead_id: l.id,
      name: fullName(l),
      phone: l.phone,
      email: l.email,
      zip: l.zip,
      dogs: l.dogs,
      serviceType: l.service_type,
      status: l.status,
      daysOld: daysSince(l.created_at),
      notes: l.notes ?? undefined,
    })),
  });
}

// list_invoices({ client_id?, status?, limit? }): browse invoice history with
// optional filters — includes paid invoices, unlike list_unpaid_invoices.
export async function list_invoices(args: {
  client_id?: string;
  status?: string;
  limit?: number;
}): Promise<string> {
  const db = supabaseServer();
  const VALID = ['draft', 'sent', 'paid', 'overdue'];
  const limit = Math.min(Math.max(Number(args?.limit) || 15, 1), 25);

  let q = db
    .from('invoices')
    .select('id, customer_id, amount, status, created_at, due_date, period_start, period_end, notes')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (args?.client_id) q = q.eq('customer_id', args.client_id);
  if (args?.status && VALID.includes(args.status)) q = q.eq('status', args.status);

  const { data, error } = await q;
  if (error) return JSON.stringify({ error: error.message, invoices: [] });

  const invoices = data ?? [];
  const customerIds = Array.from(new Set(invoices.map((i) => i.customer_id)));
  const byId = new Map<string, { first_name: string; last_name: string }>();
  if (customerIds.length > 0) {
    const { data: customers } = await db
      .from('customers')
      .select('id, first_name, last_name')
      .in('id', customerIds);
    for (const c of customers ?? []) byId.set(c.id, c);
  }

  return JSON.stringify({
    invoices: invoices.map((i) => ({
      invoice_id: i.id,
      customer: fullName(byId.get(i.customer_id)) || 'Unknown client',
      amount: i.amount,
      status: i.status,
      createdAt: i.created_at,
      dueDate: i.due_date ?? undefined,
      period: i.period_start ? `${i.period_start} → ${i.period_end ?? '…'}` : undefined,
      notes: i.notes ?? undefined,
    })),
  });
}

// get_todays_route(): today's appointments with everything a tech/operator
// needs at a glance — status, admin flags, yard notes, gate code.
export async function get_todays_route(): Promise<string> {
  const db = supabaseServer();
  const today = new Date();
  const dayStart = `${today.toISOString().slice(0, 10)}T00:00:00`;
  const dayEnd = `${today.toISOString().slice(0, 10)}T23:59:59`;

  const { data: appts, error } = await db
    .from('appointments')
    .select('id, customer_id, scheduled_at, status, service_type')
    .gte('scheduled_at', dayStart)
    .lte('scheduled_at', dayEnd)
    .order('scheduled_at', { ascending: true });

  if (error) return JSON.stringify({ error: error.message, route: [] });

  const appointments = appts ?? [];
  const customerIds = Array.from(new Set(appointments.map((a) => a.customer_id)));
  const byId = new Map<
    string,
    {
      first_name: string;
      last_name: string;
      flags?: string[];
      yard_notes?: string;
      gate_code?: string;
    }
  >();
  if (customerIds.length > 0) {
    const { data: customers } = await db
      .from('customers')
      .select('id, first_name, last_name, flags, yard_notes, gate_code')
      .in('id', customerIds);
    for (const c of customers ?? []) byId.set(c.id, c);
  }

  const route = appointments.map((a) => {
    const c = byId.get(a.customer_id);
    return {
      appointment_id: a.id,
      customer: fullName(c) || 'Unknown client',
      scheduledAt: a.scheduled_at,
      serviceType: a.service_type ?? undefined,
      status: a.status,
      flags: c?.flags ?? [],
      yardNotes: c?.yard_notes ?? undefined,
      gateCode: c?.gate_code ?? undefined,
    };
  });

  return JSON.stringify({ route });
}

// draft_sms: never sends anything. Just tells the model to compose the draft
// itself in its final reply, clearly labeled so the operator knows to copy it.
export async function draft_sms(args: {
  client_name?: string;
  purpose?: string;
  tone?: string;
}): Promise<string> {
  return JSON.stringify({
    instructions:
      'Compose the SMS draft yourself in your reply, clearly labeled as a draft for the operator to copy — do not imply it was sent.',
    client_name: args?.client_name ?? undefined,
    purpose: args?.purpose ?? undefined,
    tone: args?.tone ?? 'friendly, professional',
  });
}

import {
  propose_mark_invoice_paid,
  propose_charge_invoice,
  propose_create_invoice,
  propose_add_stop_to_route,
  propose_set_appointment_status,
  propose_update_lead_status,
  propose_convert_lead,
} from './proposals';

export const TOOL_EXECUTORS: Record<string, (args: any) => Promise<string>> = {
  get_business_snapshot,
  search_clients,
  get_client_details,
  list_unpaid_invoices,
  list_invoices,
  list_leads,
  get_todays_route,
  draft_sms,
  // Action proposers — read-only validation that returns a proposal card for
  // the operator to confirm. Execution happens only via /api/assistant/execute.
  propose_mark_invoice_paid,
  propose_charge_invoice,
  propose_create_invoice,
  propose_add_stop_to_route,
  propose_set_appointment_status,
  propose_update_lead_status,
  propose_convert_lead,
};
