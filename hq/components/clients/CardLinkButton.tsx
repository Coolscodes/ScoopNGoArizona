'use client';

import { useState } from 'react';
import { Button, useToast } from '@/components/ui';
import type { Customer } from '@/lib/types';
import { fullName } from '@/lib/format';

// Compact per-row "card link" action for the clients table. Same behavior as
// the setup-link button in ClientQuickActions: create a Stripe Checkout setup
// session and copy the URL to the clipboard (fallback: open it in a new tab).
export function CardLinkButton({ client }: { client: Customer }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function setupLink() {
    setBusy(true);
    try {
      const res = await fetch('/api/stripe/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: client.id,
          customer_name: fullName(client),
          customer_email: client.email,
          stripe_customer_id: client.stripe_customer_id,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        toast(data.error || 'Could not create setup link', 'error');
        return;
      }
      try {
        await navigator.clipboard.writeText(data.url);
        toast(`Card setup link for ${fullName(client)} copied to clipboard`);
      } catch {
        window.open(data.url, '_blank', 'noopener');
        toast('Card setup link opened');
      }
    } catch {
      toast('Could not create setup link', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={busy}
      onClick={setupLink}
      title={client.stripe_payment_method_id ? 'Copy a link to update the card on file' : 'Copy a card setup link'}
    >
      {busy ? 'Copying…' : 'Card link'}
    </Button>
  );
}
