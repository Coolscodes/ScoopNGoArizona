// Workstream 6 — Invoices API.
//   GET /api/invoices?status=sent&customer=<id>
//     -> 200 { rows, summary, balances, degraded }
//   POST /api/invoices  { customer_id, amount, due_date?, period_start?, period_end?, notes?, status? }
//     -> 200 { ok, invoice }  (status defaults to 'sent'; only 'draft'|'sent' allowed on create)
//
// Status filter accepts: draft | sent | paid | overdue (anything else = no filter).
// Returns the same shape the /invoices server component renders, so the page and
// any client-side refresh stay in sync.

import { NextResponse } from 'next/server';
import { getInvoicesData, isInvoiceStatus } from '@/components/invoices/data';
import { supabaseServer } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const statusParam = searchParams.get('status');
  const customerId = searchParams.get('customer') || undefined;

  try {
    const data = await getInvoicesData({
      status: isInvoiceStatus(statusParam) ? statusParam : undefined,
      customerId,
    });
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load invoices';
    return NextResponse.json(
      {
        error: message,
        rows: [],
        summary: { outstanding: 0, overdue: 0, paidThisWeek: 0, draftCount: 0 },
        balances: [],
        degraded: true,
      },
      { status: 500 }
    );
  }
}

// ---- create an invoice ----
export async function POST(request: Request) {
  // Defense in depth (middleware also gates this) — return clean 401 JSON.
  try {
    if (!(await getCurrentUser())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: {
    customer_id?: string;
    amount?: number;
    due_date?: string;
    period_start?: string;
    period_end?: string;
    notes?: string;
    status?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const amount = Number(body.amount);
  if (!body.customer_id || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: 'customer_id and a positive amount are required' },
      { status: 400 }
    );
  }
  const isDate = (s?: string) => !s || /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!isDate(body.due_date) || !isDate(body.period_start) || !isDate(body.period_end)) {
    return NextResponse.json({ error: 'Dates must be YYYY-MM-DD' }, { status: 400 });
  }
  // Only draft/sent can be created — paid/overdue are lifecycle states.
  const status = body.status === 'draft' ? 'draft' : 'sent';

  try {
    const sb = supabaseServer();
    const { data: cust } = await sb
      .from('customers')
      .select('id')
      .eq('id', body.customer_id)
      .single();
    if (!cust) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    const { data: inv, error } = await sb
      .from('invoices')
      .insert({
        customer_id: body.customer_id,
        amount: Math.round(amount * 100) / 100,
        status,
        due_date: body.due_date ?? null,
        period_start: body.period_start ?? null,
        period_end: body.period_end ?? null,
        notes: body.notes ?? null,
      })
      .select('*')
      .single();
    if (error) throw error;

    return NextResponse.json({ ok: true, invoice: inv });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create invoice';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
