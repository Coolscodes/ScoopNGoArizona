import { money, shortDate } from '@/lib/format';
import { InvoiceActions } from '@/components/invoices/InvoiceActions';
import type { AttentionItem } from './data';

// Actionable alert strip: overdue / past-due invoices you can resolve in place.
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
            className="flex items-center justify-between gap-3 px-5 py-3 flex-wrap"
          >
            <div className="min-w-0">
              <div className="font-heading font-bold text-danger truncate">
                {item.customerName}
              </div>
              <div className="text-[0.78rem] text-danger/80">
                {money(item.amount)} · {item.status === 'overdue' ? 'Overdue' : 'Past due'}
                {item.dueDate ? ` · due ${shortDate(item.dueDate)}` : ''}
              </div>
            </div>
            <InvoiceActions
              invoiceId={item.invoiceId}
              amount={item.amount}
              customerName={item.customerName}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
