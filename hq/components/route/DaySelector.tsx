'use client';

import { useRouter } from 'next/navigation';
import { cn } from '@/components/ui';

// Build the next `count` days as YYYY-MM-DD starting from a base date (UTC-safe).
function buildDays(baseISO: string, count: number): string[] {
  const out: string[] = [];
  const base = new Date(`${baseISO}T00:00:00Z`);
  for (let i = 0; i < count; i++) {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() + i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function shortLabel(iso: string, today: string): { weekday: string; day: string; isToday: boolean } {
  const d = new Date(`${iso}T00:00:00Z`);
  return {
    weekday: d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
    day: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
    isToday: iso === today,
  };
}

export function DaySelector({
  today,
  selected,
  days = 7,
}: {
  today: string;
  selected: string;
  days?: number;
}) {
  const router = useRouter();
  const options = buildDays(today, days);

  function go(date: string) {
    router.push(`/route?date=${date}`);
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex gap-1.5 flex-wrap">
        {options.map((iso) => {
          const { weekday, day, isToday } = shortLabel(iso, today);
          const active = iso === selected;
          return (
            <button
              key={iso}
              type="button"
              onClick={() => go(iso)}
              className={cn(
                'flex flex-col items-center rounded-card border px-3 py-1.5 min-w-[3.6rem] transition-colors',
                active
                  ? 'bg-brand text-white border-brand'
                  : 'bg-white text-muted border-line hover:border-brand'
              )}
            >
              <span className="text-[0.68rem] font-heading font-bold uppercase tracking-wide">
                {isToday ? 'Today' : weekday}
              </span>
              <span className="text-[0.78rem] font-semibold">{day}</span>
            </button>
          );
        })}
      </div>
      <input
        type="date"
        value={selected}
        onChange={(e) => {
          if (e.target.value) go(e.target.value);
        }}
        className="rounded-card border border-line bg-white px-2.5 py-2 text-sm text-ink"
        aria-label="Pick a date"
      />
    </div>
  );
}
