'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { shortDate } from '@/lib/format';
import { Button, useToast } from '@/components/ui';
import type { UnclosedVisit } from './data';

// Past visits still sitting 'scheduled'. Close each one out in place: Done
// (runs the normal completion path, auto-charge included), Done no charge
// (paid another way), or Skip (visit never happened, nothing owed).
export function UnclosedVisits({ items }: { items: UnclosedVisit[] }) {
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  if (items.length === 0) return null;

  async function close(
    item: UnclosedVisit,
    status: 'completed' | 'skipped',
    noCharge: boolean
  ) {
    setBusy(item.appointmentId);
    try {
      const res = await fetch('/api/route', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'status',
          id: item.appointmentId,
          status,
          no_charge: noCharge,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || 'Update failed');
      toast(
        status === 'skipped'
          ? `Skipped ${item.customerName} (${shortDate(item.scheduledAt)})`
          : `Marked ${item.customerName} done (${shortDate(item.scheduledAt)})`
      );
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Update failed', 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mb-6">
      <h2 className="font-heading text-[0.8rem] font-bold text-muted uppercase tracking-wider mb-2">
        Unclosed past visits
      </h2>
      <div className="rounded-card border border-[#ffe0b2] bg-[#fff8e1] divide-y divide-[#ffe0b2]">
        {items.map((item) => {
          const isBusy = busy === item.appointmentId;
          return (
            <div
              key={item.appointmentId}
              className="flex items-center justify-between gap-3 px-5 py-3 flex-wrap"
            >
              <div className="min-w-0">
                <div className="font-heading font-bold text-ink truncate">
                  {item.customerName}
                </div>
                <div className="text-[0.78rem] text-muted">
                  {shortDate(item.scheduledAt)} · still marked scheduled
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={isBusy}
                  onClick={() => close(item, 'completed', false)}
                >
                  ✓ Done
                </Button>
                <Button
                  size="sm"
                  disabled={isBusy}
                  onClick={() => close(item, 'completed', true)}
                >
                  Done, no charge
                </Button>
                <Button
                  size="sm"
                  disabled={isBusy}
                  onClick={() => close(item, 'skipped', true)}
                >
                  Skip
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
