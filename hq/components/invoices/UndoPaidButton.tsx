'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { money } from '@/lib/format';
import { useToast } from '@/components/ui';

// Undo a week that was marked paid by mistake. Shown on paid invoices in the
// invoices table and in a client's payment history.
//
// It asks first, because it deletes the payment rows for that invoice and puts
// the money back into what the client owes. The confirm expands inline rather
// than as a floating dialog, same reason as the method picker in
// InvoiceActions: inside a table an absolutely positioned popover gets clipped.
export function UndoPaidButton({
  invoiceId,
  amount,
  customerName,
  size = 'md',
}: {
  invoiceId: string;
  amount: number;
  customerName?: string;
  size?: 'sm' | 'md';
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);

  const base =
    size === 'sm'
      ? 'rounded-md px-2 py-1 text-[0.72rem] font-heading font-bold'
      : 'rounded-md px-3 py-1.5 text-[0.78rem] font-heading font-bold';

  async function undo() {
    setBusy(true);
    setAsking(false);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unmark_paid' }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast(data.error || 'Could not undo that payment', 'error');
        return;
      }
      toast(
        `${money(amount)} put back as owed${customerName ? ` for ${customerName}` : ''}`
      );
      router.refresh();
    } catch {
      toast('Could not undo that payment', 'error');
    } finally {
      setBusy(false);
    }
  }

  if (asking) {
    return (
      <span className="flex items-center gap-1.5 whitespace-nowrap">
        <span className="text-[0.72rem] text-muted font-heading font-bold">Not paid?</span>
        <button
          onClick={undo}
          className={`${base} bg-danger text-white hover:opacity-90`}
        >
          Undo
        </button>
        <button
          onClick={() => setAsking(false)}
          aria-label="Cancel"
          className="text-muted hover:text-ink px-1"
        >
          ×
        </button>
      </span>
    );
  }

  return (
    <button
      onClick={() => setAsking(true)}
      disabled={busy}
      title="Undo this payment and put the week back as owed"
      className={`${base} bg-white border border-line text-muted hover:border-danger hover:text-danger disabled:opacity-50 whitespace-nowrap`}
    >
      {busy ? '…' : 'Undo paid'}
    </button>
  );
}
