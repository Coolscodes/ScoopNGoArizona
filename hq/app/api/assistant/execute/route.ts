// Execute a CONFIRMED assistant action proposal.
//
//   POST /api/assistant/execute  { proposal: ActionProposal }
//
// This route never contains business logic of its own: it validates the
// proposal against a strict allowlist, then forwards to the existing,
// battle-tested staff endpoints (same ones the dashboard buttons call),
// passing the operator's session cookie through so auth is enforced
// end-to-end. The AI cannot reach this route, only the Confirm button does.

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import type { ActionProposal } from '@/components/assistant/proposals';

export const dynamic = 'force-dynamic';

interface ForwardSpec {
  path: string;
  method: 'POST' | 'PATCH';
  body: Record<string, unknown>;
}

function toForward(p: ActionProposal): ForwardSpec | null {
  const pl = p.payload ?? {};
  switch (p.kind) {
    case 'mark_invoice_paid':
      if (!pl.invoice_id) return null;
      return {
        path: `/api/invoices/${pl.invoice_id}`,
        method: 'PATCH',
        body: { action: 'mark_paid', method: pl.method ?? 'cash' },
      };
    case 'charge_invoice':
      if (!pl.invoice_id) return null;
      return {
        path: `/api/invoices/${pl.invoice_id}`,
        method: 'PATCH',
        body: { action: 'charge' },
      };
    case 'create_invoice':
      if (!pl.customer_id || !pl.amount) return null;
      return {
        path: '/api/invoices',
        method: 'POST',
        body: {
          customer_id: pl.customer_id,
          amount: Number(pl.amount),
          status: pl.status,
          due_date: pl.due_date,
          period_start: pl.period_start,
          period_end: pl.period_end,
          notes: pl.notes,
        },
      };
    case 'add_stop_to_route':
      if (!pl.customer_id || !pl.date) return null;
      return {
        path: '/api/route',
        method: 'POST',
        body: { date: pl.date, customer_id: pl.customer_id },
      };
    case 'set_appointment_status':
      if (!pl.appointment_id || !pl.status) return null;
      return {
        path: '/api/route',
        method: 'PATCH',
        body: { action: 'status', id: pl.appointment_id, status: pl.status },
      };
    case 'update_lead_status':
      if (!pl.lead_id || !pl.status) return null;
      return {
        path: '/api/leads',
        method: 'PATCH',
        body: { id: pl.lead_id, status: pl.status },
      };
    case 'convert_lead':
      if (!pl.lead_id) return null;
      return {
        path: '/api/leads',
        method: 'PATCH',
        body: { id: pl.lead_id, action: 'convert' },
      };
    default:
      return null;
  }
}

export async function POST(request: Request) {
  // Defense in depth, middleware gates this too.
  try {
    if (!(await getCurrentUser())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { proposal?: ActionProposal };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const proposal = body.proposal;
  if (!proposal?.kind) {
    return NextResponse.json({ error: 'proposal is required' }, { status: 400 });
  }

  const spec = toForward(proposal);
  if (!spec) {
    return NextResponse.json({ error: 'Unknown or malformed action' }, { status: 400 });
  }

  try {
    const origin = new URL(request.url).origin;
    const res = await fetch(origin + spec.path, {
      method: spec.method,
      headers: {
        'Content-Type': 'application/json',
        // Forward the operator's session so the target route re-authenticates it.
        cookie: request.headers.get('cookie') ?? '',
      },
      body: JSON.stringify(spec.body),
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: (data as { error?: string }).error ?? `Action failed (${res.status})` },
        { status: 200 }
      );
    }
    return NextResponse.json({ ok: true, result: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Action failed';
    return NextResponse.json({ ok: false, error: message }, { status: 200 });
  }
}
