'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, useToast } from '@/components/ui';
import { dayMonth } from '@/lib/format';

// Client action: skip the customer's next scheduled visit. Posts only the token
// (the page already has it from the URL); the server resolves the customer and
// the correct appointment. We confirm before mutating.
export function SkipVisitButton({
  token,
  nextVisitAt,
}: {
  token: string;
  nextVisitAt: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function doSkip() {
    setBusy(true);
    try {
      const res = await fetch('/api/portal/skip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = (await res.json().catch(() => ({}))) as { skipped?: string | null };
      if (!res.ok) {
        toast('Could not skip your visit. Please try again.', 'error');
        return;
      }
      if (data.skipped) {
        toast('Your next visit has been skipped.');
      } else {
        toast('No upcoming visit to skip.');
      }
      setConfirming(false);
      router.refresh();
    } catch {
      toast('Could not skip your visit. Please try again.', 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!nextVisitAt) {
    return (
      <Button variant="outline" disabled>
        No visit to skip
      </Button>
    );
  }

  if (!confirming) {
    return (
      <Button variant="outline" onClick={() => setConfirming(true)}>
        Skip next visit
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted">
        Skip your visit on <span className="font-bold text-ink">{dayMonth(nextVisitAt)}</span>?
      </p>
      <div className="flex gap-2">
        <Button variant="danger" onClick={doSkip} disabled={busy}>
          {busy ? 'Skipping…' : 'Yes, skip it'}
        </Button>
        <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
          Keep it
        </Button>
      </div>
    </div>
  );
}
