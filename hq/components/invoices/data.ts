// Invoices data layer, Workstream 6.
// Shared by the /invoices server component and the /api/invoices route handler
// so both return identical shapes. Server-only: it calls supabaseServer(), which
// throws if ever run in the browser (the service-role key must never reach the
// client). Only imported by server components and route handlers.

import { supabaseServer } from '@/lib/supabase';
import { todayISO } from '@/lib/format';
import type { Customer, Invoice, InvoiceStatus } from '@/lib/types';

// An invoice enriched with the client it belongs to (name + card-on-file status).
export interface InvoiceRow {
  invoice: Invoice;
  customerName: string;
  hasCardOnFile: boolean;
  // True when status is 'overdue', or 'sent' and past its due date.
  pastDue: boolean;
}

// Accounts-receivable rollup, computed once for the whole list.
export interface ArSummary {
  outstanding: number; // sum of sent + overdue invoice amounts
  overdue: number; // sum of overdue (or sent-and-past-due) amounts
  paidThisWeek: number; // sum of paid invoice amounts in the current week
  draftCount: number;
}

// Per-client balance + card-on-file flag, sorted by balance desc.
export interface ClientBalance {
  customerId: string;
  customerName: string;
  balance: number; // outstanding (sent + overdue)
  hasCardOnFile: boolean;
  stripeCustomerId?: string;
  email?: string;
}

export interface InvoicesData {
  rows: InvoiceRow[];
  summary: ArSummary;
  balances: ClientBalance[];
  // True when no data store is reachable (placeholder env / query error).
  degraded: boolean;
}

const ALL_STATUSES: InvoiceStatus[] = ['draft', 'sent', 'paid', 'overdue'];

export function isInvoiceStatus(v: string | null | undefined): v is InvoiceStatus {
  return !!v && (ALL_STATUSES as string[]).includes(v);
}

// Defensive wrapper: never throw, always resolve to an array. Mirrors the
// dashboard data layer so an empty DB / placeholder env never crashes the page.
async function safeRows<T>(
  run: () => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<{ rows: T[]; ok: boolean }> {
  try {
    const { data, error } = await run();
    if (error) return { rows: [], ok: false };
    return { rows: data ?? [], ok: true };
  } catch {
    return { rows: [], ok: false };
  }
}

function fullName(c: { first_name?: string; last_name?: string } | null | undefined): string {
  if (!c) return 'Unknown client';
  const name = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim();
  return name || 'Unknown client';
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Monday-Sunday week bounds (matches the existing charge flow).
function weekStartISO(ref: Date = new Date()): string {
  const day = ref.getDay(); // 0=Sun
  const diffToMon = day === 0 ? -6 : 1 - day;
  const monday = new Date(ref);
  monday.setDate(ref.getDate() + diffToMon);
  return monday.toISOString().split('T')[0];
}

export async function getInvoicesData(opts?: {
  status?: InvoiceStatus;
  customerId?: string;
}): Promise<InvoicesData> {
  const today = todayISO();
  const weekStart = weekStartISO();
  const sb = supabaseServer();

  // Pull every invoice once; filtering for the visible list happens after we
  // compute the AR rollup so totals reflect the whole book, not the filter.
  const invRes = await safeRows<Invoice>(() =>
    sb.from('invoices').select('*').order('created_at', { ascending: false })
  );

  const allInvoices = invRes.rows;

  const customerIds = Array.from(
    new Set(allInvoices.map((i) => i.customer_id))
  ).filter(Boolean);

  const customersById = new Map<string, Customer>();
  let custOk = true;
  if (customerIds.length > 0) {
    const custRes = await safeRows<Customer>(() =>
      sb.from('customers').select('*').in('id', customerIds)
    );
    custOk = custRes.ok;
    for (const c of custRes.rows) customersById.set(c.id, c);
  }

  const degraded = !invRes.ok && !custOk;

  const isPastDue = (i: Invoice): boolean => {
    if (i.status === 'overdue') return true;
    if (i.status === 'sent' && i.due_date) return i.due_date < today;
    return false;
  };

  // AR rollup over the full book.
  let outstanding = 0;
  let overdue = 0;
  let paidThisWeek = 0;
  let draftCount = 0;
  const balanceByCustomer = new Map<string, number>();

  for (const i of allInvoices) {
    const amount = Number(i.amount) || 0;
    if (i.status === 'sent' || i.status === 'overdue') {
      outstanding += amount;
      balanceByCustomer.set(
        i.customer_id,
        (balanceByCustomer.get(i.customer_id) ?? 0) + amount
      );
    }
    if (isPastDue(i)) overdue += amount;
    if (i.status === 'draft') draftCount += 1;
    if (i.status === 'paid' && (i.period_start ?? '') >= weekStart) {
      paidThisWeek += amount;
    }
  }

  // Per-client balances (only clients that currently owe money).
  const balances: ClientBalance[] = Array.from(balanceByCustomer.entries())
    .map(([customerId, balance]) => {
      const c = customersById.get(customerId);
      return {
        customerId,
        customerName: fullName(c),
        balance: round2(balance),
        hasCardOnFile: Boolean(c?.stripe_payment_method_id),
        stripeCustomerId: c?.stripe_customer_id,
        email: c?.email,
      };
    })
    .filter((b) => b.balance > 0)
    .sort((a, b) => b.balance - a.balance);

  // Visible list, apply the status / customer filters here.
  const visible = allInvoices.filter((i) => {
    if (opts?.customerId && i.customer_id !== opts.customerId) return false;
    if (opts?.status && i.status !== opts.status) return false;
    return true;
  });

  const rows: InvoiceRow[] = visible.map((invoice) => {
    const c = customersById.get(invoice.customer_id);
    return {
      invoice,
      customerName: fullName(c),
      hasCardOnFile: Boolean(c?.stripe_payment_method_id),
      pastDue: isPastDue(invoice),
    };
  });

  return {
    rows,
    summary: {
      outstanding: round2(outstanding),
      overdue: round2(overdue),
      paidThisWeek: round2(paidThisWeek),
      draftCount,
    },
    balances,
    degraded,
  };
}
