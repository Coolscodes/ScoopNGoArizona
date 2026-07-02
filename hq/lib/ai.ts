// Shared AI foundation — owned by the AI-hub foundation (like Workstream 0).
// Feature modules (assistant / briefings / reports) import from here; do not edit.
//
// SAFETY: everything in this file is READ-ONLY against the database. AI features
// must never write rows, send SMS/email, or touch Stripe. "Actions" are drafts
// returned to the UI for a human to review.

import Anthropic from '@anthropic-ai/sdk';
import { supabaseServer } from './supabase';
import { fullName, todayISO } from './format';

// One constant so a model change is one edit. Jett chose Sonnet (2026-07-01) for
// the cost/quality balance; bump to 'claude-opus-4-8' anytime for max quality.
export const AI_MODEL = 'claude-sonnet-4-6';

export function hasAnthropicKey(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export function anthropicClient(): Anthropic {
  return new Anthropic();
}

// Standard friendly payload when ANTHROPIC_API_KEY is missing. Routes should
// return this with status 200 rather than erroring.
export const NEEDS_KEY_RESPONSE = {
  text: 'AI features are offline — add ANTHROPIC_API_KEY to hq/.env.local (key from console.anthropic.com) and restart. Your business data is unaffected.',
  needsKey: true,
} as const;

export interface BusinessSnapshot {
  today: string;
  activeClients: number;
  todaysRoute: {
    customer: string;
    serviceType?: string;
    status: string;
    flags?: string[];
  }[];
  unpaidInvoices: {
    customer: string;
    amount: number;
    status: string;
    dueDate?: string;
    daysOld: number;
  }[];
  staleLeads: { name: string; phone: string; daysOld: number; status: string }[];
  weekCollected: number;
  recentVisits: { customer: string; completedAt: string; issue: boolean }[];
}

// Compact, read-only snapshot of the business used to ground AI prompts.
// Keep it small — it is injected into every assistant/briefing request.
export async function getBusinessSnapshot(): Promise<BusinessSnapshot> {
  const db = supabaseServer();
  const today = todayISO();

  const [customersRes, apptsRes, invoicesRes, leadsRes, paymentsRes, logsRes] =
    await Promise.all([
      db.from('customers').select('id, first_name, last_name, active, flags'),
      db
        .from('appointments')
        .select('customer_id, service_type, status, scheduled_at')
        .gte('scheduled_at', `${today}T00:00:00`)
        .lte('scheduled_at', `${today}T23:59:59`),
      db
        .from('invoices')
        .select('customer_id, amount, status, due_date, created_at')
        .in('status', ['sent', 'overdue'])
        .order('created_at', { ascending: true })
        .limit(25),
      db
        .from('leads')
        .select('first_name, last_name, phone, status, created_at')
        .in('status', ['new', 'contacted'])
        .order('created_at', { ascending: true })
        .limit(15),
      db
        .from('payments')
        .select('amount, paid_at')
        .gte('paid_at', `${today.slice(0, 8)}01`),
      db
        .from('service_logs')
        .select('customer_id, completed_at, issue_flagged')
        .order('completed_at', { ascending: false })
        .limit(10),
    ]);

  const customers = customersRes.data ?? [];
  const byId = new Map(customers.map((c) => [c.id, c]));
  const name = (id: string) => fullName(byId.get(id)) || 'Unknown client';
  const daysSince = (iso?: string | null) =>
    iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)) : 0;

  return {
    today,
    activeClients: customers.filter((c) => c.active).length,
    todaysRoute: (apptsRes.data ?? []).map((a) => ({
      customer: name(a.customer_id),
      serviceType: a.service_type ?? undefined,
      status: a.status,
      flags: byId.get(a.customer_id)?.flags ?? undefined,
    })),
    unpaidInvoices: (invoicesRes.data ?? []).map((i) => ({
      customer: name(i.customer_id),
      amount: i.amount,
      status: i.status,
      dueDate: i.due_date ?? undefined,
      daysOld: daysSince(i.created_at),
    })),
    staleLeads: (leadsRes.data ?? []).map((l) => ({
      name: fullName(l),
      phone: l.phone,
      daysOld: daysSince(l.created_at),
      status: l.status,
    })),
    weekCollected: (paymentsRes.data ?? []).reduce((s, p) => s + (p.amount ?? 0), 0),
    recentVisits: (logsRes.data ?? []).map((v) => ({
      customer: name(v.customer_id),
      completedAt: v.completed_at,
      issue: v.issue_flagged,
    })),
  };
}

// Extract the concatenated text blocks from a Messages API response.
export function textFromResponse(res: Anthropic.Message): string {
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}
