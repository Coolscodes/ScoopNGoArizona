'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast, Input, Button, cn } from '@/components/ui';

const PRESETS = [
  'dog aggressive',
  'gate code changed',
  'cash customer',
  'upsell deodorizer',
  'do not service if raining',
];

function flagClass(flag: string): string {
  const f = flag.toLowerCase();
  if (f.includes('aggress') || f.startsWith('do not') || f.includes('hazard')) {
    return 'bg-[#ffebee] text-danger';
  }
  return 'bg-[#fff8e1] text-[#f57f17]';
}

export function FlagsEditor({ clientId, flags }: { clientId: string; flags: string[] }) {
  const router = useRouter();
  const toast = useToast();
  const [current, setCurrent] = useState<string[]>(flags ?? []);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(next: string[]) {
    const prev = current;
    setCurrent(next); // optimistic
    setBusy(true);
    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flags: next }),
      });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      setCurrent(prev);
      toast('Could not save flags', 'error');
    } finally {
      setBusy(false);
    }
  }

  function add(flag: string) {
    const f = flag.trim();
    if (!f || current.includes(f)) return;
    void save([...current, f]);
  }
  function remove(flag: string) {
    void save(current.filter((x) => x !== flag));
  }

  const available = PRESETS.filter((p) => !current.includes(p));

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        {current.length === 0 && <span className="text-sm text-muted">No flags.</span>}
        {current.map((f) => (
          <span
            key={f}
            className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[0.75rem] font-heading font-bold', flagClass(f))}
          >
            {f}
            <button onClick={() => remove(f)} aria-label={`Remove ${f}`} disabled={busy} className="hover:opacity-70 leading-none">
              ×
            </button>
          </span>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {available.map((p) => (
          <button
            key={p}
            onClick={() => add(p)}
            disabled={busy}
            className="text-[0.72rem] px-2.5 py-1 rounded-full bg-tan border border-line text-muted hover:border-brand hover:text-brand disabled:opacity-50"
          >
            + {p}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { add(custom); setCustom(''); }
          }}
          placeholder="Add a custom flag"
          className="py-1.5 max-w-[14rem]"
        />
        <Button variant="outline" size="sm" disabled={busy || !custom.trim()} onClick={() => { add(custom); setCustom(''); }}>
          Add
        </Button>
      </div>
    </div>
  );
}
