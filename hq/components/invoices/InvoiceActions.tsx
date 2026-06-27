'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { money } from '@/lib/format';
import { useToast } from '@/components/ui';
import type { PayMethod } from '@/lib/types';

const METHODS: { key: PayMethod; label: string }[] = [
  { key: 'cash', label: 'Cash' },
  { key: 'venmo', label: 'Venmo' },
  { key: 'zelle', label: 'Zelle' },
  { key: 'check', label: 'Check' },
  { key: 'card', label: 'Card' },
];

// Charge-card / mark-paid actions for a single unpaid invoice. Used on the
// dashboard "needs attention" strip and on the invoices table. The payment-method
// picker expands inline (not an absolute dropdown) so it never gets clipped inside
// an overflow container like a table.
export function InvoiceActions({
  invoiceId,
  amount,
  customerName,
}: {
  invoiceId: string;
  amount: number;
  customerName: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);

  async function act(action: 'charge' | 'mark_paid', method?: PayMethod) {
    setBusy(true);
    setPicking(false);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, method }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error || 'Action failed', 'error');
        setBusy(false);
        return;
      }
      toast(
        action === 'charge'
          ? `Charged ${money(amount)} to ${customerName}`
          : `${customerName} marked paid`
      );
      router.refresh();
    } catch {
      toast('Action failed', 'error');
      setBusy(false);
    }
  }

  if (picking) {
    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[0.72rem] text-muted font-heading font-bold">Paid by:</span>
        {METHODS.map((m) => (
          <button
            key={m.key}
            onClick={() => act('mark_paid', m.key)}
            className="bg-white border border-line rounded-md px-2.5 py-1 text-[0.75rem] font-heading font-bold hover:border-brand hover:text-brand"
          >
            {m.label}
          </button>
        ))}
        <button
          onClick={() => setPicking(false)}
          aria-label="Cancel"
          className="text-muted hover:text-ink px-1"
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => act('charge')}
        disabled={busy}
        className="bg-white border border-line text-ink rounded-md px-3 py-1.5 text-[0.78rem] font-heading font-bold hover:border-brand hover:text-brand disabled:opacity-50 whitespace-nowrap"
      >
        {busy ? '…' : 'Charge card'}
      </button>
      <button
        onClick={() => setPicking(true)}
        disabled={busy}
        className="bg-brand text-white rounded-md px-3 py-1.5 text-[0.78rem] font-heading font-bold hover:bg-brand-dark disabled:opacity-50 whitespace-nowrap"
      >
        Mark paid
      </button>
    </div>
  );
}
