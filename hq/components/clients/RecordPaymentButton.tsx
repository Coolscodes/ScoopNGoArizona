'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, useToast } from '@/components/ui';
import { money } from '@/lib/format';

const METHODS = [
  { key: 'applepay', label: 'Apple Pay' },
  { key: 'cash', label: 'Cash' },
  { key: 'venmo', label: 'Venmo' },
  { key: 'zelle', label: 'Zelle' },
  { key: 'check', label: 'Check' },
  { key: 'card', label: 'Card (charged elsewhere)' },
];

// Monday of the week containing d, as YYYY-MM-DD (browser-local calendar).
function mondayOf(d: Date): string {
  const copy = new Date(d);
  const day = copy.getDay();
  copy.setDate(copy.getDate() + (day === 0 ? -6 : 1 - day));
  const y = copy.getFullYear();
  const m = String(copy.getMonth() + 1).padStart(2, '0');
  const dd = String(copy.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function weekLabel(mondayISO: string): string {
  const [y, m, d] = mondayISO.split('-').map(Number);
  const mon = new Date(y, m - 1, d);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const fmt = (x: Date) =>
    x.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(mon)} to ${fmt(sun)}`;
}

// Record money collected outside the app (Apple Pay, cash, Venmo...) against a
// specific service week. Creates the week's invoice if it was never generated.
export function RecordPaymentButton({
  customerId,
  customerName,
  price,
}: {
  customerId: string;
  customerName: string;
  price?: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [week, setWeek] = useState('');
  const [method, setMethod] = useState('applepay');
  const [amount, setAmount] = useState(price != null ? String(price) : '');

  // Current week first, then the 7 before it.
  const weeks = useMemo(() => {
    const out: { start: string; label: string }[] = [];
    const now = new Date();
    for (let i = 0; i < 8; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() - i * 7);
      const start = mondayOf(d);
      out.push({
        start,
        label: (i === 0 ? 'This week, ' : '') + weekLabel(start),
      });
    }
    return out;
  }, []);

  function openModal() {
    setWeek(weeks[0].start);
    setMethod('applepay');
    setAmount(price != null ? String(price) : '');
    setOpen(true);
  }

  async function submit() {
    const n = parseFloat(amount);
    if (Number.isNaN(n) || n <= 0) {
      toast('Enter a valid amount', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: customerId,
          period_start: week,
          amount: Math.round(n * 100) / 100,
          method,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || 'Could not record payment');
      toast(`Recorded ${money(n)} for ${customerName}`);
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not record payment', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={openModal}>
        💵 Record payment
      </Button>
      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/45 flex"
          onClick={() => !busy && setOpen(false)}
          role="presentation"
        >
          <div
            className="m-auto w-full max-w-sm px-4"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`Record payment for ${customerName}`}
          >
            <div className="bg-white rounded-card border border-line p-5">
              <h3 className="font-heading font-bold text-ink mb-1">Record payment</h3>
              <p className="text-xs text-muted mb-4">
                {customerName} paid outside the app. This marks the week paid
                (creating the invoice if needed), no card is charged.
              </p>

              <label className="block mb-3">
                <span className="block text-[0.72rem] uppercase tracking-wide text-muted mb-1">
                  Service week
                </span>
                <select
                  value={week}
                  onChange={(e) => setWeek(e.target.value)}
                  className="w-full border-2 border-line rounded-[7px] px-2.5 py-2 text-sm bg-white text-ink"
                >
                  {weeks.map((w) => (
                    <option key={w.start} value={w.start}>
                      {w.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block mb-3">
                <span className="block text-[0.72rem] uppercase tracking-wide text-muted mb-1">
                  Method
                </span>
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  className="w-full border-2 border-line rounded-[7px] px-2.5 py-2 text-sm bg-white text-ink"
                >
                  {METHODS.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block mb-4">
                <span className="block text-[0.72rem] uppercase tracking-wide text-muted mb-1">
                  Amount
                </span>
                <span className="flex items-center gap-1">
                  <span className="font-heading font-bold text-brand">$</span>
                  <input
                    type="number"
                    min={1}
                    step="0.01"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full border-2 border-line rounded-[7px] px-2.5 py-2 text-sm font-heading font-bold text-brand tabular-nums"
                  />
                </span>
              </label>

              <div className="flex justify-end gap-2">
                <Button onClick={() => setOpen(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={submit} disabled={busy}>
                  {busy ? 'Saving…' : 'Record'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
