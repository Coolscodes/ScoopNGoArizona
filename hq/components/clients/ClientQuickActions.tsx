'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, useToast } from '@/components/ui';
import { RecordPaymentButton } from './RecordPaymentButton';

// Charge the card on file (this week's visit price), record an outside payment,
// or send a card-setup link. Mirrors the invoices page actions so behavior is
// consistent across the app.
export function ClientQuickActions({
  customerId,
  customerName,
  email,
  stripeCustomerId,
  hasCard,
  price,
}: {
  customerId: string;
  customerName: string;
  email?: string;
  stripeCustomerId?: string;
  hasCard: boolean;
  price?: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function chargeNow() {
    if (!hasCard) {
      toast('No card on file, send a setup link first', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/charge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_ids: [customerId] }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        charged?: number;
        failed?: number;
        results?: { reason?: string }[];
      };
      if (!res.ok) {
        toast(data.error || 'Charge failed', 'error');
        return;
      }
      if (data.charged) toast(`Charged ${customerName}`);
      else if (data.failed) toast(`Charge failed: ${data.results?.[0]?.reason || 'declined'}`, 'error');
      else toast(`Skipped: ${data.results?.[0]?.reason || 'no charge made'}`, 'info');
      router.refresh();
    } catch {
      toast('Charge failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function setupLink() {
    setBusy(true);
    try {
      const res = await fetch('/api/stripe/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: customerId,
          customer_name: customerName,
          customer_email: email,
          stripe_customer_id: stripeCustomerId,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        toast(data.error || 'Could not create setup link', 'error');
        return;
      }
      try {
        await navigator.clipboard.writeText(data.url);
        toast('Card setup link copied to clipboard');
      } catch {
        window.open(data.url, '_blank', 'noopener');
        toast('Card setup link opened');
      }
      router.refresh();
    } catch {
      toast('Could not create setup link', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Button variant="primary" size="sm" disabled={busy || !hasCard} onClick={chargeNow}>
        {busy ? 'Working…' : 'Charge now'}
      </Button>
      <RecordPaymentButton
        customerId={customerId}
        customerName={customerName}
        price={price}
      />
      <Button variant="outline" size="sm" disabled={busy} onClick={setupLink}>
        {hasCard ? 'New card link' : 'Card setup link'}
      </Button>
    </div>
  );
}
