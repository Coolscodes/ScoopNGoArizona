'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';
import type { Customer } from '@/lib/types';
import { fullName } from '@/lib/format';
import { useCardSetupLink } from './useCardSetupLink';

// Compact per-row "card link" action for the clients table. Same behavior as
// the setup-link button in ClientQuickActions: create a Stripe Checkout setup
// session and copy the URL to the clipboard (see useCardSetupLink).
export function CardLinkButton({ client }: { client: Customer }) {
  const cardLink = useCardSetupLink();
  const [busy, setBusy] = useState(false);

  async function setupLink() {
    setBusy(true);
    try {
      await cardLink.request({
        customer_id: client.id,
        customer_name: fullName(client),
        customer_email: client.email,
        stripe_customer_id: client.stripe_customer_id,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={setupLink}
        title={client.stripe_payment_method_id ? 'Copy a link to update the card on file' : 'Copy a card setup link'}
      >
        {busy ? 'Copying…' : 'Card link'}
      </Button>
      {cardLink.modal}
    </>
  );
}
