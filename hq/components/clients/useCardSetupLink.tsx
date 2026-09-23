'use client';

import { useCallback, useState } from 'react';
import { Button, Input, Modal, useToast } from '@/components/ui';

// The one "card setup link" flow, shared by every button that offers it
// (clients table, client page, invoices balances, charge modal). Creates a
// Stripe Checkout setup session and gets its URL onto the clipboard.
//
// Why this is not a plain writeText after the fetch: iOS Safari only lets a
// page write the clipboard inside the tap that asked for it, and that tap is
// spent by the time Stripe answers. So the write is queued synchronously,
// before any await, as a ClipboardItem whose text is a promise. Safari and
// Chrome resolve it after the fetch, still under the original tap. A browser
// that refuses that gets a plain writeText, and if that is blocked too the
// link opens in a modal with its own Copy / Share / Open buttons, each of
// which is a fresh tap.

export interface CardSetupLinkInput {
  customer_id: string;
  customer_name?: string;
  customer_email?: string | null;
  stripe_customer_id?: string | null;
}

async function createSetupUrl(input: CardSetupLinkInput): Promise<string> {
  const res = await fetch('/api/stripe/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customer_id: input.customer_id,
      customer_name: input.customer_name,
      customer_email: input.customer_email ?? undefined,
      stripe_customer_id: input.stripe_customer_id ?? undefined,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !data.url) throw new Error(data.error || 'Could not create setup link');
  return data.url;
}

// Queues a clipboard write for text that is not known yet. Must run
// synchronously inside the user's tap. Resolves false when the browser will
// not take a promise-valued ClipboardItem or refuses the write; the caller
// then falls back. A failed fetch also lands here as false, and the caller
// reports that error itself.
function queueClipboardWrite(text: Promise<string>): Promise<boolean> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    return Promise.resolve(false);
  }
  const blob = text.then((t) => new Blob([t], { type: 'text/plain' }));
  blob.catch(() => {});
  try {
    return navigator.clipboard
      .write([new ClipboardItem({ 'text/plain': blob })])
      .then(() => true, () => false);
  } catch {
    return Promise.resolve(false);
  }
}

interface PendingLink {
  url: string;
  name?: string;
  what: string;
}

// The generic version: any link that has to be fetched and then copied under
// the same tap. The signup payment link uses this too, so both links behave
// identically on his phone.
export function useCopyableLink() {
  const toast = useToast();
  const [pending, setPending] = useState<PendingLink | null>(null);
  const close = useCallback(() => setPending(null), []);

  // Call this synchronously from the click handler, with no await before it,
  // so the clipboard write can still ride on the tap. Resolves the link when
  // one was created (copied, or shown in the modal), null on failure. Callers
  // that want to keep the link on screen, like the signup flow, hold onto it.
  const request = useCallback(
    async (
      create: () => Promise<string>,
      meta: { name?: string; what?: string } = {}
    ): Promise<string | null> => {
      const what = meta.what ?? 'Link';
      const urlPromise = create();
      const queued = queueClipboardWrite(urlPromise);

      let url: string;
      try {
        url = await urlPromise;
      } catch (e) {
        toast(e instanceof Error ? e.message : `Could not create ${what.toLowerCase()}`, 'error');
        return null;
      }

      const who = meta.name ? ` for ${meta.name}` : '';
      if (await queued) {
        toast(`${what}${who} copied to clipboard`);
        return url;
      }
      try {
        await navigator.clipboard.writeText(url);
        toast(`${what}${who} copied to clipboard`);
      } catch {
        setPending({ url, name: meta.name, what });
      }
      return url;
    },
    [toast]
  );

  const modal = <CardSetupLinkModal pending={pending} onClose={close} />;
  return { request, modal };
}

export function useCardSetupLink() {
  const link = useCopyableLink();
  const request = useCallback(
    (input: CardSetupLinkInput) =>
      link.request(() => createSetupUrl(input), {
        name: input.customer_name,
        what: 'Card setup link',
      }),
    [link]
  );
  return { request, modal: link.modal };
}

function CardSetupLinkModal({
  pending,
  onClose,
}: {
  pending: PendingLink | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  if (!pending) return null;
  const { url, name, what } = pending;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast(`${what} copied to clipboard`);
      onClose();
    } catch {
      toast('Copy is blocked here, tap the link to select it', 'error');
    }
  }

  async function share() {
    try {
      await navigator.share({
        title: what,
        text: `Scoop N Go${name ? `, ${name}` : ''}`,
        url,
      });
      onClose();
    } catch {
      // Share sheet dismissed, keep the modal open.
    }
  }

  return (
    <Modal open onClose={onClose} title={what}>
      <p className="text-sm text-muted mb-3">
        {name ? `The link for ${name} is ready.` : 'The link is ready.'} Copy it, or send it
        straight to the client.
      </p>
      <Input
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        aria-label={what}
      />
      <div className="flex items-center gap-2 mt-3 flex-wrap">
        <Button variant="primary" size="sm" onClick={copy}>
          Copy link
        </Button>
        {canShare && (
          <Button size="sm" onClick={share}>
            Share…
          </Button>
        )}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center rounded-[7px] border-2 border-line px-3 py-1.5 text-[0.78rem] font-heading font-bold text-muted hover:border-brand hover:text-brand"
        >
          Open
        </a>
      </div>
    </Modal>
  );
}
