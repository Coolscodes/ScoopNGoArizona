'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, useToast } from '@/components/ui';
import { RecordPaymentButton } from './RecordPaymentButton';
import { useCardSetupLink } from './useCardSetupLink';

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
  const cardLink = useCardSetupLink();
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

  // A client who has a Stripe customer but no saved card is usually one who
  // paid a signup link that nobody came back to confirm. This asks Stripe,
  // then keeps the card and marks the weeks the payment bought. It is the same
  // endpoint the signup screen calls, and it charges nothing.
  async function checkSignup() {
    setBusy(true);
    try {
      const res = await fetch('/api/signup/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_id: customerId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        paid?: boolean;
        card_saved?: boolean;
        amount?: number;
        weeks?: { booked: string }[];
        problems?: string[];
        reason?: string;
        error?: string;
      };
      if (!res.ok) {
        toast(data.error || 'Could not check with Stripe', 'error');
        return;
      }
      if (!data.paid) {
        toast(data.reason || 'No signup payment found', 'info');
        return;
      }
      const marked = (data.weeks ?? []).filter((w) => w.booked !== 'already paid').length;
      toast(
        data.problems?.length
          ? `Paid, but check: ${data.problems[0]}`
          : `Signup found. ${data.card_saved ? 'Card saved' : 'Card not saved'}${
              marked ? `, ${marked} week${marked > 1 ? 's' : ''} marked paid` : ''
            }.`,
        data.problems?.length ? 'error' : 'success'
      );
      router.refresh();
    } catch {
      toast('Could not check with Stripe', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function setupLink() {
    setBusy(true);
    try {
      const ok = await cardLink.request({
        customer_id: customerId,
        customer_name: customerName,
        customer_email: email,
        stripe_customer_id: stripeCustomerId,
      });
      if (ok) router.refresh();
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
      {!hasCard && (
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={checkSignup}
          title="Did they pay a signup link? Saves their card and marks the weeks it covered."
        >
          Check signup payment
        </Button>
      )}
      {cardLink.modal}
    </div>
  );
}
