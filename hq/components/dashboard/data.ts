// Dashboard data layer — Workstream 1.
// Shared by the /dashboard server component and the /api/dashboard route handler
// so both return identical metrics. Server-only: it calls supabaseServer(),
// which throws if ever run in the browser (the service-role key must never ship
// to the client). Only imported by a server component and a route handler.

import { supabaseServer } from '@/lib/supabase';
import { todayISO, weekBounds } from '@/lib/format';
import type { Appointment, Customer } from '@/lib/types';

// An appointment enriched with its customer + dog count for the route list.
export interface RouteStop {
  appointment: Appointment;
  customer: Customer | null;
  dogCount: number;
}

// An overdue / past-due invoice paired with its client name + amount.
export interface AttentionItem {
  invoiceId: string;
  customerId: string;
  customerName: string;
  amount: number;
  status: string;
  dueDate?: string;
}

export interface DashboardData {
  metrics: {
    todaysStops: number;
    collectedThisWeek: number;
    unpaid: number;
    newRequests: number;
  };
  needsAttention: AttentionItem[];
  route: RouteStop[];
  // True when no data store is reachable (placeholder env / query error).
  // The UI still renders gracefully; this just lets callers know it's empty-by-default.
  degraded: boolean;
}

// Defensive wrapper: never throw, always resolve to an array. The DB may be
// empty or the env keys may be placeholders — the dashboard must not crash.
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

export async function getDashboardData(): Promise<DashboardData> {
  const today = todayISO();
  const { start: weekStart, end: weekEnd } = weekBounds();
  const sb = supabaseServer();

  // scheduled_at may be a date or a timestamp; bound the whole day [today, today+1).
  const tomorrow = nextDayISO(today);

  const [apptRes, paymentsRes, invoicesRes, leadsRes] = await Promise.all([
    safeRows<Appointment>(() =>
      sb
        .from('appointments')
        .select('*')
        .gte('scheduled_at', today)
        .lt('scheduled_at', tomorrow)
    ),
    safeRows<{ amount: number | null; paid_at: string | null }>(() =>
      sb
        .from('payments')
        .select('amount, paid_at')
        .gte('paid_at', weekStart)
        .lte('paid_at', weekEnd + 'T23:59:59.999Z')
    ),
    safeRows<{
      id: string;
      customer_id: string;
      amount: number | null;
      status: string;
      due_date: string | null;
    }>(() =>
      sb
        .from('invoices')
        .select('id, customer_id, amount, status, due_date')
        .in('status', ['sent', 'overdue'])
    ),
    safeRows<{ id: string }>(() =>
      sb.from('leads').select('id').eq('status', 'new')
    ),
  ]);

  const degraded =
    !apptRes.ok && !paymentsRes.ok && !invoicesRes.ok && !leadsRes.ok;

  const todaysAppointments = apptRes.rows;

  // Metric: today's stops still scheduled.
  const todaysStops = todaysAppointments.filter(
    (a) => a.status === 'scheduled'
  ).length;

  // Metric: collected this week (sum of payments paid within Mon–Sun).
  const collectedThisWeek = paymentsRes.rows.reduce(
    (sum, p) => sum + (Number(p.amount) || 0),
    0
  );

  // Metric: unpaid = sum of sent/overdue invoice amounts.
  const unpaid = invoicesRes.rows.reduce(
    (sum, i) => sum + (Number(i.amount) || 0),
    0
  );

  // Metric: new lead requests.
  const newRequests = leadsRes.rows.length;

  // Gather customer ids we need (route stops + attention invoices) in one fetch.
  const customerIds = Array.from(
    new Set([
      ...todaysAppointments.map((a) => a.customer_id),
      ...invoicesRes.rows.map((i) => i.customer_id),
    ])
  ).filter(Boolean);

  const customersById = new Map<string, Customer>();
  const dogCountByCustomer = new Map<string, number>();

  if (customerIds.length > 0) {
    const [custRes, dogRes] = await Promise.all([
      safeRows<Customer>(() =>
        sb.from('customers').select('*').in('id', customerIds)
      ),
      safeRows<{ customer_id: string }>(() =>
        sb.from('dogs').select('customer_id').in('customer_id', customerIds)
      ),
    ]);
    for (const c of custRes.rows) customersById.set(c.id, c);
    for (const d of dogRes.rows) {
      dogCountByCustomer.set(
        d.customer_id,
        (dogCountByCustomer.get(d.customer_id) ?? 0) + 1
      );
    }
  }

  // Needs-attention strip: overdue, or sent but past its due_date.
  const needsAttention: AttentionItem[] = invoicesRes.rows
    .filter((i) => {
      if (i.status === 'overdue') return true;
      if (i.status === 'sent' && i.due_date) return i.due_date < today;
      return false;
    })
    .map((i) => ({
      invoiceId: i.id,
      customerId: i.customer_id,
      customerName: fullName(customersById.get(i.customer_id)),
      amount: Number(i.amount) || 0,
      status: i.status,
      dueDate: i.due_date ?? undefined,
    }))
    .sort((a, b) => b.amount - a.amount);

  // Today's route — ordered by route_position (nulls last), then created time.
  const route: RouteStop[] = todaysAppointments
    .slice()
    .sort((a, b) => {
      const pa = a.route_position ?? Number.POSITIVE_INFINITY;
      const pb = b.route_position ?? Number.POSITIVE_INFINITY;
      if (pa !== pb) return pa - pb;
      return (a.created_at ?? '').localeCompare(b.created_at ?? '');
    })
    .map((a) => ({
      appointment: a,
      customer: customersById.get(a.customer_id) ?? null,
      dogCount: dogCountByCustomer.get(a.customer_id) ?? 0,
    }));

  return {
    metrics: {
      todaysStops,
      collectedThisWeek: round2(collectedThisWeek),
      unpaid: round2(unpaid),
      newRequests,
    },
    needsAttention,
    route,
    degraded,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// YYYY-MM-DD -> next calendar day, UTC-safe.
function nextDayISO(iso: string): string {
  const d = new Date(iso + 'T00:00:00.000Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
