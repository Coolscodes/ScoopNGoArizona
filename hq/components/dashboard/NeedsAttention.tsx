import { money, shortDate } from '@/lib/format';
import type { AttentionItem } from './data';

// Alert strip for invoices that need attention (overdue or past-due).
// Renders nothing when there's nothing to flag.
export function NeedsAttention({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) return null;

  return (
    <div className="mb-6">
      <h2 className="font-heading text-[0.8rem] font-bold text-muted uppercase tracking-wider mb-2">
        Needs attention
      </h2>
      <div className="rounded-card border border-[#ffcdd2] bg-[#ffebee] divide-y divide-[#ffcdd2]">
        {items.map((item) => (
          <div
            key={item.invoiceId}
            className="flex items-center justify-between gap-4 px-5 py-3"
          >
            <div className="min-w-0">
              <div className="font-heading font-bold text-danger truncate">
                {item.customerName}
              </div>
              <div className="text-[0.78rem] text-danger/80">
                {item.status === 'overdue' ? 'Overdue' : 'Past due'}
                {item.dueDate ? ` · due ${shortDate(item.dueDate)}` : ''}
              </div>
            </div>
            <div className="font-heading font-black text-danger whitespace-nowrap">
              {money(item.amount)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
