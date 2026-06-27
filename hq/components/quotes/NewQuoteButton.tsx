'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, useToast } from '@/components/ui';

// Creates a blank draft quote and navigates to its builder.
export function NewQuoteButton() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    const res = await fetch('/api/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_items: [] }),
    });
    setBusy(false);
    if (!res.ok) {
      toast('Could not create quote', 'error');
      return;
    }
    const data = (await res.json()) as { quote?: { id: string } };
    if (data.quote?.id) {
      router.push(`/quotes/${data.quote.id}`);
    } else {
      router.refresh();
    }
  }

  return (
    <Button variant="primary" onClick={create} disabled={busy}>
      {busy ? 'Creating…' : 'New quote'}
    </Button>
  );
}
