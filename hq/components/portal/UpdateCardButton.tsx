'use client';

import { useState } from 'react';
import { Button, useToast } from '@/components/ui';

// Client action: update / add a card on file. Card setup is owned by Workstream 6
// at POST /api/stripe/setup. We hand it the portal token so it can identify THIS
// customer without staff auth, and follow whatever Stripe URL it returns.
//
// Workstream 6 isn't necessarily merged when this ships, so we degrade gracefully:
// any non-OK / unexpected response just shows a friendly toast instead of breaking
// the page.
export function UpdateCardButton({ hasCard }: { hasCard: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  function readToken(): string {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('token') || '';
  }

  async function start() {
    const token = readToken();
    if (!token) {
      toast('Please reopen your account link and try again.', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/stripe/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portal_token: token }),
      });
      if (!res.ok) {
        toast('Card updates are not available yet. Please check back soon.', 'error');
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { url?: string };
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      toast('Card updates are not available yet. Please check back soon.', 'error');
    } catch {
      toast('Could not start card setup. Please try again.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="primary" size="sm" onClick={start} disabled={busy}>
      {busy ? 'Opening…' : hasCard ? 'Update card' : 'Add card'}
    </Button>
  );
}
