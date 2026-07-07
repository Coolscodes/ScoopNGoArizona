import { Card, CardBody, EmptyState } from '@/components/ui';
import { money } from '@/lib/format';
import type { ArAgingBucket } from './data';

// Bucket -> bar color, oldest buckets read as more urgent.
const bucketTone: Record<string, string> = {
  '0-14d': 'bg-brand',
  '15-30d': 'bg-warn',
  '31-60d': 'bg-[#ef6c00]',
  '60d+': 'bg-danger',
};

// Horizontal bars, outstanding A/R (sent + overdue invoices) bucketed by age.
export function ArAgingChart({ data }: { data: ArAgingBucket[] }) {
  const total = data.reduce((sum, b) => sum + b.total, 0);
  const max = Math.max(...data.map((b) => b.total), 1);

  return (
    <Card>
      <CardBody>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-heading text-[0.8rem] font-bold text-muted uppercase tracking-wider">
            A/R aging
          </h2>
          <span className="text-sm font-semibold text-ink">{money(total)} outstanding</span>
        </div>
        {total === 0 ? (
          <EmptyState title="No outstanding invoices" hint="All caught up, nothing unpaid." />
        ) : (
          <div className="space-y-3">
            {data.map((b) => (
              <div key={b.label} className="flex items-center gap-3">
                <div className="w-16 shrink-0 text-[0.78rem] font-semibold text-muted">
                  {b.label}
                </div>
                <div className="flex-1 h-6 bg-tan rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${bucketTone[b.label] ?? 'bg-brand'}`}
                    style={{ width: `${Math.max((b.total / max) * 100, b.total > 0 ? 3 : 0)}%` }}
                  />
                </div>
                <div className="w-24 shrink-0 text-right text-sm font-heading font-bold text-ink">
                  {money(b.total)}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
