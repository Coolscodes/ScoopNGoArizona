'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  StatCard,
  Table,
  Th,
  Td,
  StatusPill,
  EmptyState,
  Button,
  useToast,
} from '@/components/ui';
import { money, shortDate } from '@/lib/format';
import { InvoiceActions } from './InvoiceActions';
import type { InvoiceStatus } from '@/lib/types';
import type { ArSummary, ClientBalance, InvoiceRow } from './data';

type FilterKey = 'all' | InvoiceStatus;

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'sent', label: 'Sent' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'paid', label: 'Paid' },
];

export function InvoicesView({
  rows,
  summary,
  balances,
}: {
  rows: InvoiceRow[];
  summary: ArSummary;
  balances: ClientBalance[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [filter, setFilter] = useState<FilterKey>('all');
  // customerId currently being charged / linked (disables that row's buttons).
  const [busy, setBusy] = useState<string | null>(null);

  const visibleRows = useMemo(() => {
    if (filter === 'all') return rows;
    return rows.filter((r) => r.invoice.status === filter);
  }, [rows, filter]);

  async function chargeNow(b: ClientBalance) {
    if (!b.hasCardOnFile) {
      toast('No card on file, send a setup link first', 'error');
      return;
    }
    setBusy(b.customerId);
    try {
      const res = await fetch('/api/charge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_ids: [b.customerId] }),
      });
      const data = (await res.json()) as {
        error?: string;
        charged?: number;
        failed?: number;
        skipped?: number;
        results?: { status: string; reason?: string }[];
      };
      if (!res.ok) {
        toast(data.error || 'Charge failed', 'error');
        return;
      }
      const first = data.results?.[0];
      if (data.charged) {
        toast(`Charged ${b.customerName}`);
      } else if (data.failed) {
        toast(`Charge failed: ${first?.reason || 'declined'}`, 'error');
      } else {
        toast(`Skipped: ${first?.reason || 'no charge made'}`, 'info');
      }
      router.refresh();
    } catch {
      toast('Charge failed', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function sendSetupLink(b: ClientBalance) {
    setBusy(b.customerId);
    try {
      const res = await fetch('/api/stripe/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: b.customerId,
          customer_name: b.customerName,
          customer_email: b.email,
          stripe_customer_id: b.stripeCustomerId,
        }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        toast(data.error || 'Could not create setup link', 'error');
        return;
      }
      // Copy the hosted Checkout link so it can be texted/emailed to the client.
      try {
        await navigator.clipboard.writeText(data.url);
        toast('Card setup link copied to clipboard');
      } catch {
        // Clipboard may be blocked, open it instead.
        window.open(data.url, '_blank', 'noopener');
        toast('Card setup link opened');
      }
      router.refresh();
    } catch {
      toast('Could not create setup link', 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px] items-start">
      <div>
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-6">
          <StatCard label="Outstanding" value={money(summary.outstanding)} tone="warn" />
          <StatCard label="Overdue" value={money(summary.overdue)} tone="danger" />
          <StatCard
            label="Paid this week"
            value={money(summary.paidThisWeek)}
            tone="success"
          />
          <StatCard label="Drafts" value={summary.draftCount} tone="info" />
        </div>

        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={
                'px-3 py-1.5 rounded-full text-[0.78rem] font-heading font-bold transition-colors ' +
                (filter === f.key
                  ? 'bg-brand text-white'
                  : 'bg-white border border-line text-muted hover:border-brand hover:text-brand')
              }
            >
              {f.label}
            </button>
          ))}
          <span className="text-sm text-muted ml-auto">{visibleRows.length} shown</span>
        </div>

        {visibleRows.length === 0 ? (
          <EmptyState
            title="No invoices"
            hint="Invoices appear here once the weekly generator runs or you charge a client."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Client</Th>
                <Th>Week</Th>
                <Th>Due</Th>
                <Th className="text-right">Amount</Th>
                <Th>Status</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r) => (
                <tr key={r.invoice.id} className="hover:bg-[#fafafa]">
                  <Td>
                    <Link
                      href={`/clients/${r.invoice.customer_id}`}
                      className="font-heading font-bold text-ink hover:text-brand"
                    >
                      {r.customerName}
                    </Link>
                    {!r.hasCardOnFile && (
                      <span className="block text-xs text-muted">No card on file</span>
                    )}
                  </Td>
                  <Td className="text-sm text-muted">
                    {r.invoice.period_start ? shortDate(r.invoice.period_start) : '·'}
                  </Td>
                  <Td className="text-sm text-muted">
                    {r.invoice.due_date ? shortDate(r.invoice.due_date) : '·'}
                  </Td>
                  <Td className="text-right font-heading font-bold">
                    {money(r.invoice.amount)}
                  </Td>
                  <Td>
                    <StatusPill status={r.pastDue ? 'overdue' : r.invoice.status} />
                  </Td>
                  <Td>
                    {r.invoice.status !== 'paid' && (
                      <InvoiceActions
                        invoiceId={r.invoice.id}
                        amount={r.invoice.amount}
                        customerName={r.customerName}
                      />
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>

      <BalancesPanel
        balances={balances}
        busy={busy}
        onCharge={chargeNow}
        onSetupLink={sendSetupLink}
      />
    </div>
  );
}

function BalancesPanel({
  balances,
  busy,
  onCharge,
  onSetupLink,
}: {
  balances: ClientBalance[];
  busy: string | null;
  onCharge: (b: ClientBalance) => void;
  onSetupLink: (b: ClientBalance) => void;
}) {
  return (
    <div className="bg-white rounded-card border border-line">
      <div className="px-5 py-4 border-b border-line">
        <h2 className="font-heading text-[0.8rem] font-bold text-muted uppercase tracking-wider">
          Client balances
        </h2>
      </div>
      {balances.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-muted">
          Everyone is paid up.
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {balances.map((b) => {
            const isBusy = busy === b.customerId;
            return (
              <li key={b.customerId} className="px-5 py-4">
                <div className="flex items-baseline justify-between gap-3">
                  <Link
                    href={`/clients/${b.customerId}`}
                    className="font-heading font-bold text-ink hover:text-brand"
                  >
                    {b.customerName}
                  </Link>
                  <span className="font-heading font-black text-warn">
                    {money(b.balance)}
                  </span>
                </div>
                <div className="text-xs text-muted mt-0.5">
                  {b.hasCardOnFile ? 'Card on file' : 'No card on file'}
                </div>
                <div className="flex gap-2 mt-3">
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={isBusy || !b.hasCardOnFile}
                    onClick={() => onCharge(b)}
                    title={b.hasCardOnFile ? 'Charge the card on file now' : 'No card on file'}
                  >
                    {isBusy ? 'Working…' : 'Charge now'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isBusy}
                    onClick={() => onSetupLink(b)}
                  >
                    {b.hasCardOnFile ? 'New card link' : 'Card setup link'}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
