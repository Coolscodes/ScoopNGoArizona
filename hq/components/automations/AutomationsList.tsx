'use client';

import { useState } from 'react';
import { Card, CardBody, useToast, cn } from '@/components/ui';
import type { Automation } from '@/lib/types';

// Short, human descriptions for each known automation key. Falls back to the
// label if a key isn't in this map (so new seeded rows still render sensibly).
const DESCRIPTIONS: Record<string, string> = {
  on_my_way:
    'Text the client an "on my way" message when their stop becomes the next one on the route.',
  visit_complete:
    'Text the client a "visit complete" confirmation with the gate photo after each visit.',
  weekly_charge:
    'Automatically charge cards on file each week for completed visits (billing engine).',
  review_request:
    'Ask happy clients for a review after their 4th completed visit.',
  failed_payment:
    'Alert you (and optionally the client) when a card charge fails.',
};

// Grouping so the page reads sensibly instead of a flat list.
const GROUPS: { title: string; hint: string; keys: string[] }[] = [
  {
    title: 'Client messaging',
    hint: 'Texts sent to clients around their visits.',
    keys: ['on_my_way', 'visit_complete', 'review_request'],
  },
  {
    title: 'Billing',
    hint: 'Money movement and payment alerts.',
    keys: ['weekly_charge', 'failed_payment'],
  },
];

function Toggle({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        checked ? 'bg-brand' : 'bg-line'
      )}
    >
      <span
        className={cn(
          'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-[22px]' : 'translate-x-0.5'
        )}
      />
    </button>
  );
}

export function AutomationsList({ initial }: { initial: Automation[] }) {
  const toast = useToast();
  const [items, setItems] = useState<Automation[]>(initial);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const byKey = new Map(items.map((a) => [a.key, a]));
  // Any seeded rows whose key isn't in a defined group still render in "Other".
  const grouped = new Set(GROUPS.flatMap((g) => g.keys));
  const ungrouped = items.filter((a) => !grouped.has(a.key));

  async function toggle(item: Automation) {
    const nextEnabled = !item.enabled;
    setSavingKey(item.key);
    // Optimistic flip.
    setItems((prev) =>
      prev.map((a) => (a.key === item.key ? { ...a, enabled: nextEnabled } : a))
    );
    try {
      const res = await fetch('/api/automations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: item.key, enabled: nextEnabled }),
      });
      if (!res.ok) throw new Error('save failed');
      toast(`${item.label} ${nextEnabled ? 'on' : 'off'}`);
    } catch {
      // Roll back.
      setItems((prev) =>
        prev.map((a) => (a.key === item.key ? { ...a, enabled: item.enabled } : a))
      );
      toast('Could not update that automation', 'error');
    } finally {
      setSavingKey(null);
    }
  }

  function row(item: Automation) {
    return (
      <div
        key={item.key}
        className="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0 border-b border-line last:border-b-0"
      >
        <div className="min-w-0">
          <div className="font-heading font-bold text-ink">{item.label}</div>
          <p className="text-sm text-muted mt-0.5">
            {DESCRIPTIONS[item.key] ?? 'Automation toggle.'}
          </p>
        </div>
        <Toggle
          checked={item.enabled}
          disabled={savingKey === item.key}
          onChange={() => toggle(item)}
          label={`Toggle ${item.label}`}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      {GROUPS.map((group) => {
        const rows = group.keys
          .map((k) => byKey.get(k))
          .filter((a): a is Automation => Boolean(a));
        if (rows.length === 0) return null;
        return (
          <section key={group.title}>
            <h2 className="font-heading text-[0.8rem] font-bold text-muted uppercase tracking-wider mb-2">
              {group.title}
            </h2>
            <Card>
              <CardBody>{rows.map(row)}</CardBody>
            </Card>
            <p className="text-[0.78rem] text-muted mt-1.5">{group.hint}</p>
          </section>
        );
      })}

      {ungrouped.length > 0 && (
        <section>
          <h2 className="font-heading text-[0.8rem] font-bold text-muted uppercase tracking-wider mb-2">
            Other
          </h2>
          <Card>
            <CardBody>{ungrouped.map(row)}</CardBody>
          </Card>
        </section>
      )}
    </div>
  );
}
