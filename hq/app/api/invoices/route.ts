// Workstream 6 — Invoices API (collection, read-only list).
//   GET /api/invoices?status=sent&customer=<id>
//     -> 200 { rows, summary, balances, degraded }
//
// Status filter accepts: draft | sent | paid | overdue (anything else = no filter).
// Returns the same shape the /invoices server component renders, so the page and
// any client-side refresh stay in sync.

import { NextResponse } from 'next/server';
import { getInvoicesData, isInvoiceStatus } from '@/components/invoices/data';

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
