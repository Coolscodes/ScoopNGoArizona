'use client';

// Keeps server-rendered data fresh without manual reloads: re-fetches the
// current route when the tab regains focus and on an interval while visible.
// router.refresh() re-runs the server components in place; client state
// (open modals, form drafts) is preserved.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const INTERVAL_MS = 60_000;

export function AutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    function refreshIfVisible() {
      if (document.visibilityState === 'visible') router.refresh();
    }

    window.addEventListener('focus', refreshIfVisible);
    document.addEventListener('visibilitychange', refreshIfVisible);
    const timer = setInterval(refreshIfVisible, INTERVAL_MS);

    return () => {
      window.removeEventListener('focus', refreshIfVisible);
      document.removeEventListener('visibilitychange', refreshIfVisible);
      clearInterval(timer);
    };
  }, [router]);

  return null;
}
