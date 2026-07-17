// Action proposals for the Scoop HQ assistant.
//
// SAFETY MODEL: the AI can only PROPOSE actions. Each proposer below runs
// read-only validation (resolve ids, check state) and returns a structured
// proposal. Nothing executes until the operator clicks Confirm in the UI,
// which POSTs the proposal to /api/assistant/execute, and that route only
// forwards to the existing, session-gated staff APIs. The AI never holds a
// pen; it hands you a filled-in form.

import { supabaseServer } from '@/lib/supabase';
import { fullName, money, todayISO } from '@/lib/format';
import type { PayMethod } from '@/lib/types';

export type ProposalKind =
  | 'mark_invoice_paid'
  | 'charge_invoice'
  | 'create_invoice'
  | 'add_stop_to_route'
  | 'set_appointment_status'
  | 'update_lead_status'
  | 'convert_lead';

export interface ActionProposal {
  kind: ProposalKind;
  label: string; // short human-readable summary shown on the card
  details: Record<string, string>; // display rows on the card
  payload: Record<string, string>; // exact params /api/assistant/execute needs
}

const PAY_METHODS: PayMethod[] = ['cash', 'venmo', 'zelle', 'check', 'card', 'applepay'];
const APPT_STATUSES = ['completed', 'scheduled', 'skipped'] as const;

function proposalJson(p: ActionProposal): string {
  // The assistant route detects __proposal in tool output and surfaces it to the UI.
  return JSON.stringify({
    __proposal: p,
    note: 'Proposal created. It is NOT executed, the operator must confirm it in the UI. Tell the operator what you prepared and that it awaits their confirmation.',
  });
}

// ---- mark an invoice paid (money collected outside the app) ----
export async function propose_mark_invoice_paid(args: {
  invoice_id?: string;
  method?: string;
}): Promise<string> {
  const { invoice_id } = args ?? {};
  if (!invoice_id) return JSON.stringify({ error: 'invoice_id is required, find it via list_unpaid_invoices or get_client_details.' });
  const method = PAY_METHODS.includes(args?.method as PayMethod) ? (args!.method as PayMethod) : 'cash';

  const db = supabaseServer();
  const { data: inv } = await db.from('invoices').select('id, customer_id, amount, status').eq('id', invoice_id).single();
  if (!inv) return JSON.stringify({ error: 'Invoice not found.' });
  if (inv.status === 'paid') return JSON.stringify({ error: 'That invoice is already paid.' });
  const { data: cust } = await db.from('customers').select('first_name, last_name').eq('id', inv.customer_id).single();
  const who = fullName(cust) || 'Unknown client';

  return proposalJson({
    kind: 'mark_invoice_paid',
    label: `Mark ${who}'s ${money(inv.amount)} invoice paid (${method})`,
    details: { Client: who, Amount: money(inv.amount), 'Paid via': method, 'Invoice status': inv.status },
    payload: { invoice_id: inv.id, method },
  });
}

// ---- charge the card on file for an invoice ----
export async function propose_charge_invoice(args: { invoice_id?: string }): Promise<string> {
  const { invoice_id } = args ?? {};
  if (!invoice_id) return JSON.stringify({ error: 'invoice_id is required, find it via list_unpaid_invoices or get_client_details.' });

  const db = supabaseServer();
  const { data: inv } = await db.from('invoices').select('id, customer_id, amount, status').eq('id', invoice_id).single();
  if (!inv) return JSON.stringify({ error: 'Invoice not found.' });
  if (inv.status === 'paid') return JSON.stringify({ error: 'That invoice is already paid.' });
  const { data: cust } = await db
    .from('customers')
    .select('first_name, last_name, stripe_customer_id, stripe_payment_method_id')
    .eq('id', inv.customer_id)
    .single();
  const who = fullName(cust) || 'Unknown client';
  if (!cust?.stripe_payment_method_id) {
    return JSON.stringify({ error: `${who} has no card on file, suggest sending a card setup link instead.` });
  }

  return proposalJson({
    kind: 'charge_invoice',
    label: `Charge ${who}'s card on file ${money(inv.amount)}`,
    details: { Client: who, Amount: money(inv.amount), Method: 'Card on file (Stripe)', 'Invoice status': inv.status },
    payload: { invoice_id: inv.id },
  });
}

// ---- create a new invoice ----
export async function propose_create_invoice(args: {
  client_id?: string;
  amount?: number;
  due_date?: string;
  period_start?: string;
  period_end?: string;
  notes?: string;
  status?: string;
}): Promise<string> {
  const { client_id } = args ?? {};
  if (!client_id) return JSON.stringify({ error: 'client_id is required, find it via search_clients.' });
  const amount = Number(args?.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return JSON.stringify({ error: 'A positive amount is required.' });
  }
  const isDate = (s?: string) => !s || /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!isDate(args?.due_date) || !isDate(args?.period_start) || !isDate(args?.period_end)) {
    return JSON.stringify({ error: 'Dates must be YYYY-MM-DD.' });
  }
  const status = args?.status === 'draft' ? 'draft' : 'sent';

  const db = supabaseServer();
  const { data: cust } = await db
    .from('customers')
    .select('id, first_name, last_name, active')
    .eq('id', client_id)
    .single();
  if (!cust) return JSON.stringify({ error: 'Client not found.' });
  const who = fullName(cust);

  const details: Record<string, string> = {
    Client: who,
    Amount: money(amount),
    Status: status,
  };
  if (args?.due_date) details['Due'] = args.due_date;
  if (args?.period_start) details['Period'] = `${args.period_start} → ${args.period_end ?? '…'}`;
  if (args?.notes) details['Notes'] = args.notes;
  if (!cust.active) details['Warning'] = 'Client is INACTIVE';

  const payload: Record<string, string> = {
    customer_id: cust.id,
    amount: String(Math.round(amount * 100) / 100),
    status,
  };
  if (args?.due_date) payload.due_date = args.due_date;
  if (args?.period_start) payload.period_start = args.period_start;
  if (args?.period_end) payload.period_end = args.period_end;
  if (args?.notes) payload.notes = args.notes;

  return proposalJson({
    kind: 'create_invoice',
    label: `Create a ${money(amount)} invoice for ${who}${status === 'draft' ? ' (draft)' : ''}`,
    details,
    payload,
  });
}

// ---- add a client to a day's route ----
export async function propose_add_stop_to_route(args: {
  client_id?: string;
  date?: string;
}): Promise<string> {
  const { client_id } = args ?? {};
  const date = args?.date ?? todayISO();
  if (!client_id) return JSON.stringify({ error: 'client_id is required, find it via search_clients.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return JSON.stringify({ error: 'date must be YYYY-MM-DD.' });

  const db = supabaseServer();
  const { data: cust } = await db.from('customers').select('id, first_name, last_name, active').eq('id', client_id).single();
  if (!cust) return JSON.stringify({ error: 'Client not found.' });
  const who = fullName(cust);
  const { data: existing } = await db
    .from('appointments')
    .select('id')
    .eq('customer_id', client_id)
    .eq('scheduled_at', date)
    .neq('status', 'cancelled')
    .limit(1);
  if (existing && existing.length > 0) {
    return JSON.stringify({ error: `${who} already has a stop on ${date}.` });
  }

  return proposalJson({
    kind: 'add_stop_to_route',
    label: `Add ${who} to the route on ${date}`,
    details: { Client: who, Date: date, Active: cust.active ? 'yes' : 'NO, inactive client' },
    payload: { customer_id: cust.id, date },
  });
}

// ---- update a lead's pipeline status (not conversion) ----
export async function propose_update_lead_status(args: {
  lead_id?: string;
  status?: string;
}): Promise<string> {
  const { lead_id, status } = args ?? {};
  if (!lead_id) return JSON.stringify({ error: 'lead_id is required, find it via list_leads.' });
  const allowed = ['new', 'contacted', 'lost'];
  if (!allowed.includes(status ?? '')) {
    return JSON.stringify({
      error: "status must be 'new', 'contacted', or 'lost'. To convert a lead into a client, use propose_convert_lead instead.",
    });
  }

  const db = supabaseServer();
  const { data: lead } = await db
    .from('leads')
    .select('id, first_name, last_name, status')
    .eq('id', lead_id)
    .single();
  if (!lead) return JSON.stringify({ error: 'Lead not found.' });
  const who = fullName(lead);

  return proposalJson({
    kind: 'update_lead_status',
    label: `Mark lead ${who} as ${status}`,
    details: { Lead: who, 'Current status': lead.status, 'New status': status! },
    payload: { lead_id: lead.id, status: status! },
  });
}

// ---- convert a lead into a real client ----
export async function propose_convert_lead(args: { lead_id?: string }): Promise<string> {
  const { lead_id } = args ?? {};
  if (!lead_id) return JSON.stringify({ error: 'lead_id is required, find it via list_leads.' });

  const db = supabaseServer();
  const { data: lead } = await db
    .from('leads')
    .select('id, first_name, last_name, phone, email, status, service_type, dogs')
    .eq('id', lead_id)
    .single();
  if (!lead) return JSON.stringify({ error: 'Lead not found.' });
  if (lead.status === 'converted') return JSON.stringify({ error: 'That lead is already converted.' });
  const who = fullName(lead);

  return proposalJson({
    kind: 'convert_lead',
    label: `Convert lead ${who} into a client`,
    details: {
      Lead: who,
      Phone: lead.phone || '·',
      'Service asked for': lead.service_type || '·',
      Dogs: lead.dogs || '·',
      'Current status': lead.status,
    },
    payload: { lead_id: lead.id },
  });
}

// ---- mark a stop completed / skipped / back to scheduled ----
export async function propose_set_appointment_status(args: {
  appointment_id?: string;
  status?: string;
}): Promise<string> {
  const { appointment_id, status } = args ?? {};
  if (!appointment_id) return JSON.stringify({ error: 'appointment_id is required, find it via get_todays_route.' });
  if (!APPT_STATUSES.includes(status as (typeof APPT_STATUSES)[number])) {
    return JSON.stringify({ error: "status must be 'completed', 'skipped', or 'scheduled'." });
  }

  const db = supabaseServer();
  const { data: appt } = await db
    .from('appointments')
    .select('id, customer_id, scheduled_at, status')
    .eq('id', appointment_id)
    .single();
  if (!appt) return JSON.stringify({ error: 'Appointment not found.' });
  const { data: cust } = await db.from('customers').select('first_name, last_name').eq('id', appt.customer_id).single();
  const who = fullName(cust) || 'Unknown client';

  return proposalJson({
    kind: 'set_appointment_status',
    label: `Mark ${who}'s ${appt.scheduled_at} stop ${status}`,
    details: { Client: who, Date: appt.scheduled_at, 'Current status': appt.status, 'New status': status! },
    payload: { appointment_id: appt.id, status: status! },
  });
}
