import { Card, CardBody, EmptyState } from '@/components/ui';
import type { LeadFunnelData } from './data';

const stages: { key: keyof LeadFunnelData['counts']; label: string; tone: string }[] = [
  { key: 'new', label: 'New', tone: 'bg-info' },
  { key: 'contacted', label: 'Contacted', tone: 'bg-warn' },
  { key: 'converted', label: 'Converted', tone: 'bg-brand' },
  { key: 'lost', label: 'Lost', tone: 'bg-danger' },
];

// Horizontal bars, lead funnel by status, plus an all-time conversion callout.
export function LeadFunnelChart({ data }: { data: LeadFunnelData }) {
  const max = Math.max(...stages.map((s) => data.counts[s.key]), 1);

  return (
    <Card>
      <CardBody>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-heading text-[0.8rem] font-bold text-muted uppercase tracking-wider">
            Lead funnel
          </h2>
          <span className="text-sm font-heading font-bold text-brand-dark">
            {Math.round(data.conversionRate)}% conversion
          </span>
        </div>
        {data.total === 0 ? (
          <EmptyState title="No leads yet" hint="New leads will appear here as they come in." />
        ) : (
          <div className="space-y-3">
            {stages.map((s) => {
              const count = data.counts[s.key];
              return (
                <div key={s.key} className="flex items-center gap-3">
                  <div className="w-24 shrink-0 text-[0.78rem] font-semibold text-muted">
                    {s.label}
                  </div>
                  <div className="flex-1 h-6 bg-tan rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${s.tone}`}
                      style={{ width: `${Math.max((count / max) * 100, count > 0 ? 3 : 0)}%` }}
                    />
                  </div>
                  <div className="w-10 shrink-0 text-right text-sm font-heading font-bold text-ink">
                    {count}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
