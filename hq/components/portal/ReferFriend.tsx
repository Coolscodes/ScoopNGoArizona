'use client';

import { useState } from 'react';
import { Button, useToast } from '@/components/ui';

// Client action: refer a friend. No backend yet — copies a shareable referral
// message (with the customer's first name) to the clipboard, or falls back to the
// native share sheet on mobile.
export function ReferFriend({ firstName }: { firstName: string }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  const message =
    `${firstName} uses Scoop N Go for pet-waste cleanup and loves it! ` +
    `Mention them when you sign up and we'll both get a free visit. ` +
    `Get started at scoopngoarizona.com`;

  async function share() {
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title: 'Scoop N Go', text: message });
        return;
      }
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(message);
        setCopied(true);
        toast('Referral message copied — paste it to a friend!');
        setTimeout(() => setCopied(false), 2500);
        return;
      }
      toast('Copy this message to share with a friend.', 'error');
    } catch {
      // User cancelled the share sheet — silently ignore.
    }
  }

  return (
    <Button variant="outline" onClick={share}>
      {copied ? 'Copied!' : 'Refer a friend'}
    </Button>
  );
}
