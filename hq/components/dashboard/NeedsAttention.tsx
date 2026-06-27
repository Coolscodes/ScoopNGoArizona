'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { money, shortDate } from '@/lib/format';
import { useToast } from '@/components/ui';
import type { AttentionItem } from './data';
import type { PayMethod } from '@/lib/types';

const METHODS: { key: PayMethod; label: string }[] = [
  { key: 'cash', label: 'Cash' },
  { key: 'venmo', label: 'Venmo' },
  { key: 'zelle', label: 'Zelle' },
  { key: 'check', label: 'Check' },
  { key: 'card', label: 'Card (manual)' },
];

// Actionable alert strip: overdue / past-due invoices you can resolve in place.
export function NeedsAttention({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mb-6">
      <h2 className="font-heading text-[0.8rem] font-bold text-muted uppercase tracking-wider mb-2">
        Needs attention
      </h2>
      <div className="rounded-card border border-[#ffcdd2] bg-[#ffebee] divide-y divide-[#ffcdd2]">
        {items.map((item) => (
          <AttentionRow key={item.invoiceId} item={item} />
        ))}
      </div>
    </div>
  );
}

function AttentionRow({ item }: { item: AttentionItem }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  async function act(action: 'charge' | 'mark_paid', method?: PayMethod) {
    setBusy(true);
    setMenuOpen(false);
    try {
      const res = await fetch(`/api/invoices/${item.invoiceId}`, {
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
          ? `Charged ${money(item.amount)} to ${item.customerName}`
          : `${item.customerName} marked paid`,
      );
      router.refresh();
    } catch {
      toast('Action failed', 'error');
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3 flex-wrap">
      <div className="min-w-0">
        <div className="font-heading font-bold text-danger truncate">{item.customerName}</div>
        <div className="text-[0.78rem] text-danger/80">
          {money(item.amount)} · {item.status === 'overdue' ? 'Overdue' : 'Past due'}
          {item.dueDate ? ` · due ${shortDate(item.dueDate)}` : ''}
        </div>
      </div>

      <div className="flex items-center gap-2 relative">
        <button
          onClick={() => act('charge')}
          disabled={busy}
          className="bg-white border border-[#ffcdd2] text-danger rounded-md px-3 py-1.5 text-[0.78rem] font-heading font-bold hover:bg-[#fff5f5] disabled:opacity-50"
        >
          {busy ? '…' : 'Charge card'}
        </button>
        <button
          onClick={() => setMenuOpen((o) => !o)}
          disabled={busy}
          className="bg-brand text-white rounded-md px-3 py-1.5 text-[0.78rem] font-heading font-bold hover:bg-brand-dark disabled:opacity-50"
        >
          Mark paid ▾
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 z-10 bg-white border border-line rounded-lg shadow-lg overflow-hidden min-w-[9rem]">
            <div className="px-3 py-1.5 text-[0.7rem] text-muted font-heading font-bold uppercase tracking-wide border-b border-line">
              Paid by
            </div>
            {METHODS.map((m) => (
              <button
                key={m.key}
                onClick={() => act('mark_paid', m.key)}
                className="block w-full text-left px-3 py-2 text-[0.82rem] hover:bg-brand-light"
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
