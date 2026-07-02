// Reports data layer — Reports & Insights module.
// Shared by the /reports server component and the /api/reports route handler
// so both return identical numbers. Server-only: it calls supabaseServer(),
// which throws if ever run in the browser (the service-role key must never
// ship to the client). Only imported by a server component and a route handler.
//
// READ-ONLY: this module never inserts/updates/deletes any row.

import { supabaseServer } from '@/lib/supabase';
import type { Customer } from '@/lib/types';

export interface HeadlineMetrics {
  activeClients: number;
  mrrEstimate: number;
  collectedThisMonth: number;
  outstandingAR: number;
}

export interface MonthlyRevenuePoint {
  month: string; // e.g. "Feb"
  total: number;
}

export interface ArAgingBucket {
  label: string; // e.g. "0-14d"
  total: number;
}

export interface LeadFunnelData {
  counts: Record<'new' | 'contacted' | 'converted' | 'lost', number>;
  total: number;
  conversionRate: number; // 0-100
}

export interface WeeklyVisitPoint {
  weekStart: string; // YYYY-MM-DD (Monday)
  count: number;
  issues: number;
}

export interface TopClient {
  customerId: string;
  name: string;
  total: number;
}

export interface ReportsData {
  headline: HeadlineMetrics;
  monthlyRevenue: MonthlyRevenuePoint[];
  arAging: ArAgingBucket[];
  leadFunnel: LeadFunnelData;
  weeklyVisits: WeeklyVisitPoint[];
  topClients: TopClient[];
  // True when no data store is reachable (placeholder env / query error).
  // The UI still renders gracefully; this just lets callers know it's empty-by-default.
  degraded: boolean;
}

// Defensive wrapper: never throw, always resolve to an array. The DB may be
// empty or the env keys may be placeholders — reports must not crash.
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function fullName(c: { first_name?: string; last_name?: string } | null | undefined): string {
  if (!c) return 'Unknown client';
  const name = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim();
  return name || 'Unknown client';
}

// Estimate visits/month for a client based on frequency_weeks, falling back to
// the service_type label when frequency is missing.
function visitsPerMonth(c: Pick<Customer, 'frequency_weeks' | 'service_type'>): number {
  if (c.frequency_weeks === 1) return 4.33;
  if (c.frequency_weeks === 2) return 2.17;
  if (c.frequency_weeks && c.frequency_weeks > 0) return 4.33 / c.frequency_weeks;

  const type = (c.service_type ?? '').toLowerCase();
  if (type.includes('bi-weekly') || type.includes('biweekly') || type.includes('bi weekly')) {
    return 2.17;
  }
  if (type.includes('weekly')) return 4.33;
  return 0; // one-time / unknown — don't count toward recurring MRR
}

// UTC-safe start-of-month string (YYYY-MM-01).
function monthStartISO(monthsAgo: number, ref: Date = new Date()): { iso: string; label: string } {
  const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - monthsAgo, 1));
  const iso = d.toISOString().slice(0, 10);
  const label = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  return { iso, label };
}

// Monday of the week containing `ref`, UTC-safe, as YYYY-MM-DD.
function mondayOfWeek(ref: Date): string {
  const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()));
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diffToMon = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diffToMon);
  return d.toISOString().slice(0, 10);
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00.000Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

export async function getReportsData(): Promise<ReportsData> {
  const sb = supabaseServer();
  const now = new Date();

  // Window bounds computed up front so all queries can run in parallel.
  const sixMonthsAgoStart = monthStartISO(5, now).iso; // oldest of the 6 months we show
  const eightWeeksAgoStart = addDaysISO(mondayOfWeek(now), -7 * 7); // oldest of the 8 weeks we show

  const [
    customersRes,
    paymentsAllRes,
    invoicesUnpaidRes,
    leadsRes,
    serviceLogsRes,
    invoicesAllRes,
  ] = await Promise.all([
    safeRows<Customer>(() => sb.from('customers').select('*').eq('active', true)),
    safeRows<{ amount: number | null; paid_at: string | null; invoice_id: string }>(() =>
      sb
        .from('payments')
        .select('amount, paid_at, invoice_id')
        .gte('paid_at', sixMonthsAgoStart)
    ),
    safeRows<{
      id: string;
      customer_id: string;
      amount: number | null;
      status: string;
      created_at: string;
      due_date: string | null;
    }>(() =>
      sb
        .from('invoices')
        .select('id, customer_id, amount, status, created_at, due_date')
        .in('status', ['sent', 'overdue'])
    ),
    safeRows<{ id: string; status: string }>(() => sb.from('leads').select('id, status')),
    safeRows<{ id: string; customer_id: string; completed_at: string; issue_flagged: boolean }>(
      () =>
        sb
          .from('service_logs')
          .select('id, customer_id, completed_at, issue_flagged')
          .gte('completed_at', eightWeeksAgoStart)
    ),
    // Needed for top-clients lifetime revenue: map invoice_id -> customer_id.
    safeRows<{ id: string; customer_id: string }>(() =>
      sb.from('invoices').select('id, customer_id')
    ),
  ]);

  const degraded =
    !customersRes.ok &&
    !paymentsAllRes.ok &&
    !invoicesUnpaidRes.ok &&
    !leadsRes.ok &&
    !serviceLogsRes.ok &&
    !invoicesAllRes.ok;

  // ---- Headline metrics ----
  const activeClients = customersRes.rows.length;

  const mrrEstimate = customersRes.rows.reduce((sum, c) => {
    const price = Number(c.price_per_visit) || 0;
    return sum + price * visitsPerMonth(c);
  }, 0);

  const monthStartThis = monthStartISO(0, now).iso;
  const collectedThisMonth = paymentsAllRes.rows
    .filter((p) => (p.paid_at ?? '') >= monthStartThis)
    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

  const outstandingAR = invoicesUnpaidRes.rows.reduce(
    (sum, i) => sum + (Number(i.amount) || 0),
    0
  );

  // ---- Monthly revenue (last 6 calendar months of payments) ----
  const months = Array.from({ length: 6 }, (_, i) => monthStartISO(5 - i, now));
  const monthTotals = new Map<string, number>(months.map((m) => [m.iso, 0]));
  for (const p of paymentsAllRes.rows) {
    if (!p.paid_at) continue;
    const bucket = months
      .slice()
      .reverse()
      .find((m) => p.paid_at! >= m.iso);
    if (bucket) {
      monthTotals.set(bucket.iso, (monthTotals.get(bucket.iso) ?? 0) + (Number(p.amount) || 0));
    }
  }
  const monthlyRevenue: MonthlyRevenuePoint[] = months.map((m) => ({
    month: m.label,
    total: round2(monthTotals.get(m.iso) ?? 0),
  }));

  // ---- A/R aging (unpaid invoices bucketed by age since created_at) ----
  const agingBuckets: ArAgingBucket[] = [
    { label: '0-14d', total: 0 },
    { label: '15-30d', total: 0 },
    { label: '31-60d', total: 0 },
    { label: '60d+', total: 0 },
  ];
  for (const inv of invoicesUnpaidRes.rows) {
    const created = inv.created_at ? new Date(inv.created_at) : now;
    const age = Math.max(0, daysBetween(now, created));
    const amount = Number(inv.amount) || 0;
    let idx = 3;
    if (age <= 14) idx = 0;
    else if (age <= 30) idx = 1;
    else if (age <= 60) idx = 2;
    agingBuckets[idx].total += amount;
  }
  for (const b of agingBuckets) b.total = round2(b.total);

  // ---- Lead funnel ----
  const counts = { new: 0, contacted: 0, converted: 0, lost: 0 };
  for (const lead of leadsRes.rows) {
    const status = lead.status as keyof typeof counts;
    if (status in counts) counts[status]++;
  }
  const totalLeads = leadsRes.rows.length;
  const conversionRate = totalLeads > 0 ? round2((counts.converted / totalLeads) * 100) : 0;

  // ---- Weekly visits (completed service_logs, last 8 weeks) ----
  const weekStarts = Array.from({ length: 8 }, (_, i) =>
    addDaysISO(mondayOfWeek(now), -7 * (7 - i))
  );
  const weekBuckets = new Map<string, { count: number; issues: number }>(
    weekStarts.map((w) => [w, { count: 0, issues: 0 }])
  );
  for (const log of serviceLogsRes.rows) {
    if (!log.completed_at) continue;
    const wk = mondayOfWeek(new Date(log.completed_at));
    const bucket = weekBuckets.get(wk);
    if (bucket) {
      bucket.count += 1;
      if (log.issue_flagged) bucket.issues += 1;
    }
  }
  const weeklyVisits: WeeklyVisitPoint[] = weekStarts.map((w) => ({
    weekStart: w,
    count: weekBuckets.get(w)?.count ?? 0,
    issues: weekBuckets.get(w)?.issues ?? 0,
  }));

  // ---- Top clients (all-time payments total, joined invoices -> payments) ----
  const invoiceCustomer = new Map<string, string>();
  for (const inv of invoicesAllRes.rows) invoiceCustomer.set(inv.id, inv.customer_id);

  // Need all-time payments (not just last 6 months) for lifetime totals.
  const paymentsAllTimeRes = await safeRows<{ amount: number | null; invoice_id: string }>(() =>
    sb.from('payments').select('amount, invoice_id')
  );

  const totalsByCustomer = new Map<string, number>();
  for (const p of paymentsAllTimeRes.rows) {
    const customerId = invoiceCustomer.get(p.invoice_id);
    if (!customerId) continue;
    totalsByCustomer.set(
      customerId,
      (totalsByCustomer.get(customerId) ?? 0) + (Number(p.amount) || 0)
    );
  }

  const customerIds = Array.from(totalsByCustomer.keys());
  const namesById = new Map<string, string>();
  if (customerIds.length > 0) {
    const custRes = await safeRows<{
      id: string;
      first_name?: string;
      last_name?: string;
    }>(() => sb.from('customers').select('id, first_name, last_name').in('id', customerIds));
    for (const c of custRes.rows) namesById.set(c.id, fullName(c));
  }

  const topClients: TopClient[] = Array.from(totalsByCustomer.entries())
    .map(([customerId, total]) => ({
      customerId,
      name: namesById.get(customerId) ?? 'Unknown client',
      total: round2(total),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  return {
    headline: {
      activeClients,
      mrrEstimate: round2(mrrEstimate),
      collectedThisMonth: round2(collectedThisMonth),
      outstandingAR: round2(outstandingAR),
    },
    monthlyRevenue,
    arAging: agingBuckets,
    leadFunnel: {
      counts,
      total: totalLeads,
      conversionRate,
    },
    weeklyVisits,
    topClients,
    degraded,
  };
}
