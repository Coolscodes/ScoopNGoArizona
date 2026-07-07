'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';
import type { QuoteStatus } from '@/lib/types';

// Public Approve / Decline controls for /quote/[token]. No auth; hits the
// token-scoped public endpoint only.
export function QuoteApproval({
  token,
  initialStatus,
}: {
  token: string;
  initialStatus: QuoteStatus;
}) {
  const [status, setStatus] = useState<QuoteStatus>(initialStatus);
  const [busy, setBusy] = useState<'approve' | 'decline' | null>(null);
  const [error, setError] = useState('');

  async function act(action: 'approve' | 'decline') {
    setBusy(action);
    setError('');
    try {
      const res = await fetch(`/api/quotes/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error('request failed');
      const data = (await res.json()) as { quote?: { status?: QuoteStatus } };
      setStatus(data.quote?.status ?? (action === 'approve' ? 'approved' : 'declined'));
    } catch {
      setError('Something went wrong. Please try again or contact us.');
    } finally {
      setBusy(null);
    }
  }

  if (status === 'approved') {
    return (
      <div className="rounded-card border border-line bg-brand-light px-5 py-4 text-center">
        <p className="font-heading font-bold text-brand-dark">Quote approved, thank you!</p>
        <p className="text-sm text-muted mt-1">
          We&apos;ll be in touch shortly to get your first visit scheduled.
        </p>
      </div>
    );
  }

  if (status === 'declined') {
    return (
      <div className="rounded-card border border-line bg-[#f5f5f5] px-5 py-4 text-center">
        <p className="font-heading font-bold text-ink">Quote declined</p>
        <p className="text-sm text-muted mt-1">
          No problem. Reach out any time if you change your mind.
        </p>
      </div>
    );
  }

  return (
    <div>
      {error && <p className="text-sm text-danger mb-3 text-center">{error}</p>}
      <div className="flex flex-col sm:flex-row gap-3">
        <Button
          variant="primary"
          className="flex-1 py-3 text-base"
          onClick={() => act('approve')}
          disabled={busy !== null}
        >
          {busy === 'approve' ? 'Approving…' : 'Approve this quote'}
        </Button>
        <Button
          variant="outline"
          className="flex-1 py-3 text-base"
          onClick={() => act('decline')}
          disabled={busy !== null}
        >
          {busy === 'decline' ? 'Declining…' : 'Decline'}
        </Button>
      </div>
    </div>
  );
}
