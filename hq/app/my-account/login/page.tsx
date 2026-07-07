'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, FormField, Input } from '@/components/ui';
import { PortalShell } from '@/components/portal/PortalShell';

// PUBLIC customer entry point. The customer types their email; we ask
// /api/portal to resolve (and, if needed, mint) their portal_token, then send
// them to /my-account?token=... .
//
// To avoid leaking which emails are customers, the API returns { token: null }
// for unknown emails, we surface the same neutral message either way.
export default function PortalLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setNotFound(false);
    setLoading(true);
    try {
      const res = await fetch('/api/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json().catch(() => ({}))) as { token?: string | null; error?: string };
      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.');
        return;
      }
      if (data.token) {
        router.push(`/my-account?token=${encodeURIComponent(data.token)}`);
        return;
      }
      // Unknown email, neutral message, no enumeration.
      setNotFound(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <PortalShell>
      <form
        onSubmit={onSubmit}
        className="bg-white rounded-card border border-line p-7 w-full max-w-sm mx-auto text-center"
      >
        <h2 className="font-heading text-lg font-black text-brand-dark mb-1">My Account</h2>
        <p className="text-sm text-muted mb-6">
          Enter the email on your account to view your visits and balance.
        </p>
        <div className="text-left">
          <FormField label="Email">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="you@example.com"
              required
            />
          </FormField>
        </div>
        {error && <p className="text-danger text-sm mb-3">{error}</p>}
        {notFound && (
          <p className="text-muted text-sm mb-3">
            If that email is on file, your account link is ready. Double-check the address or
            contact us if you need help.
          </p>
        )}
        <Button type="submit" variant="primary" className="w-full" disabled={loading}>
          {loading ? 'Looking up…' : 'View my account'}
        </Button>
      </form>
    </PortalShell>
  );
}
