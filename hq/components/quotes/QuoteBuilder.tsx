'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Card,
  Button,
  Input,
  Select,
  Textarea,
  StatusPill,
  useToast,
} from '@/components/ui';
import { money } from '@/lib/format';
import type { Quote, QuoteLineItem } from '@/lib/types';

const INTERVALS = ['weekly', 'bi-weekly', 'monthly'];

type Line = QuoteLineItem & { _key: string };

let _seq = 0;
function withKeys(items: QuoteLineItem[]): Line[] {
  return items.map((it) => ({ ...it, _key: `k${_seq++}` }));
}

export function QuoteBuilder({ quote, baseUrl }: { quote: Quote; baseUrl: string }) {
  const router = useRouter();
  const toast = useToast();

  const [lines, setLines] = useState<Line[]>(withKeys(quote.line_items ?? []));
  const [recurringAmount, setRecurringAmount] = useState<string>(
    quote.recurring_amount != null ? String(quote.recurring_amount) : ''
  );
  const [recurringInterval, setRecurringInterval] = useState<string>(quote.recurring_interval ?? '');
  const [notes, setNotes] = useState<string>(quote.notes ?? '');
  const [status, setStatus] = useState(quote.status);
  const [token, setToken] = useState(quote.public_token);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  const subtotal = useMemo(
    () => lines.filter((l) => !l.recurring).reduce((s, l) => s + (Number(l.amount) || 0), 0),
    [lines]
  );

  const shareUrl = token ? `${baseUrl}/quote/${token}` : '';
  const locked = status === 'approved' || status === 'declined';

  function updateLine(key: string, patch: Partial<QuoteLineItem>) {
    setLines((prev) => prev.map((l) => (l._key === key ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, { _key: `k${_seq++}`, label: '', amount: 0 }]);
  }
  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l._key !== key));
  }

  function payload() {
    return {
      id: quote.id,
      line_items: lines.map(({ label, amount, recurring }) => ({
        label,
        amount: Number(amount) || 0,
        ...(recurring ? { recurring: true } : {}),
      })),
      recurring_amount: recurringAmount === '' ? null : Number(recurringAmount),
      recurring_interval: recurringInterval || null,
      notes,
    };
  }

  async function patch(extra: Record<string, unknown> = {}) {
    const res = await fetch('/api/quotes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload(), ...extra }),
    });
    if (!res.ok) throw new Error('save failed');
    return (await res.json()) as { quote: Quote };
  }

  async function save() {
    setSaving(true);
    try {
      await patch();
      toast('Quote saved');
      router.refresh();
    } catch {
      toast('Could not save quote', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function send() {
    setSending(true);
    try {
      const { quote: updated } = await patch({ status: 'sent' });
      setStatus(updated.status);
      setToken(updated.public_token);
      toast('Quote sent — share the link below');
      router.refresh();
    } catch {
      toast('Could not send quote', 'error');
    } finally {
      setSending(false);
    }
  }

  function copyLink() {
    if (!shareUrl) return;
    navigator.clipboard?.writeText(shareUrl).then(
      () => toast('Link copied'),
      () => toast('Copy failed', 'error')
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem] items-start">
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="font-heading font-bold">Line items</div>
          <StatusPill status={status} />
        </div>

        <div className="space-y-2">
          {lines.length === 0 && (
            <p className="text-sm text-muted">No line items yet. Add one to build the quote.</p>
          )}
          {lines.map((l) => (
            <div key={l._key} className="flex flex-wrap items-center gap-2">
              <Input
                placeholder="Description"
                value={l.label}
                disabled={locked}
                onChange={(e) => updateLine(l._key, { label: e.target.value })}
                className="flex-1 min-w-[10rem] py-2"
              />
              <Input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={l.amount === 0 && l.label === '' ? '' : l.amount}
                disabled={locked}
                onChange={(e) =>
                  updateLine(l._key, { amount: e.target.value === '' ? 0 : Number(e.target.value) })
                }
                className="w-28 py-2"
              />
              <label className="flex items-center gap-1.5 text-xs text-muted whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={Boolean(l.recurring)}
                  disabled={locked}
                  onChange={(e) => updateLine(l._key, { recurring: e.target.checked })}
                />
                Recurring
              </label>
              {!locked && (
                <button
                  onClick={() => removeLine(l._key)}
                  aria-label="Remove line"
                  className="text-muted hover:text-danger text-lg leading-none px-1"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>

        {!locked && (
          <div className="mt-3">
            <Button variant="outline" size="sm" onClick={addLine}>
              + Add line item
            </Button>
          </div>
        )}

        <div className="border-t border-line mt-4 pt-4 flex items-center justify-between">
          <span className="text-sm text-muted">One-time subtotal</span>
          <span className="font-heading font-bold text-lg">{money(subtotal)}</span>
        </div>

        <div className="border-t border-line mt-4 pt-4">
          <div className="font-heading font-bold mb-3">Recurring plan (optional)</div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[0.8rem] font-heading font-bold text-muted mb-1.5">
                Amount per visit ($)
              </span>
              <Input
                type="number"
                step="0.01"
                value={recurringAmount}
                disabled={locked}
                onChange={(e) => setRecurringAmount(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="block text-[0.8rem] font-heading font-bold text-muted mb-1.5">
                Interval
              </span>
              <Select
                value={recurringInterval}
                disabled={locked}
                onChange={(e) => setRecurringInterval(e.target.value)}
              >
                <option value="">—</option>
                {INTERVALS.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </Select>
            </label>
          </div>
        </div>

        <div className="border-t border-line mt-4 pt-4">
          <label className="block">
            <span className="block text-[0.8rem] font-heading font-bold text-muted mb-1.5">
              Internal notes
            </span>
            <Textarea value={notes} disabled={locked} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>
      </Card>

      <Card className="p-5">
        <div className="font-heading font-bold mb-3">Actions</div>
        {locked ? (
          <p className="text-sm text-muted mb-4">
            This quote is {status} and can no longer be edited.
          </p>
        ) : (
          <div className="flex flex-col gap-2 mb-4">
            <Button variant="outline" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save draft'}
            </Button>
            <Button variant="primary" onClick={send} disabled={sending}>
              {sending ? 'Sending…' : status === 'sent' ? 'Re-save & keep sent' : 'Send quote'}
            </Button>
          </div>
        )}

        {shareUrl && (status === 'sent' || locked) && (
          <div className="border-t border-line pt-4">
            <div className="text-[0.72rem] uppercase tracking-wide text-muted mb-1">Shareable link</div>
            <div className="flex items-center gap-2">
              <a
                href={shareUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-brand break-all hover:underline"
              >
                {shareUrl}
              </a>
            </div>
            <Button variant="outline" size="sm" className="mt-2" onClick={copyLink}>
              Copy link
            </Button>
          </div>
        )}

        {quote.approved_at && (
          <p className="text-xs text-muted mt-4">
            Approved {new Date(quote.approved_at).toLocaleString()}
          </p>
        )}
      </Card>
    </div>
  );
}
