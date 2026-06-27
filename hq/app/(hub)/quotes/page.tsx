import Link from 'next/link';
import { PageHeader, Table, Th, Td, StatusPill, EmptyState } from '@/components/ui';
import { NewQuoteButton } from '@/components/quotes/NewQuoteButton';
import { supabaseServer } from '@/lib/supabase';
import { money, shortDate, fullName } from '@/lib/format';
import type { Quote, Customer, Lead, QuoteLineItem } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Named = { first_name: string; last_name: string };

async function getQuotes(): Promise<{
  quotes: Quote[];
  customers: Record<string, Named>;
  leads: Record<string, Named>;
}> {
  try {
    const sb = supabaseServer();
    const { data: quotes } = await sb
      .from('quotes')
      .select('*')
      .order('created_at', { ascending: false });
    const rows = (quotes ?? []) as Quote[];

    const custIds = Array.from(new Set(rows.map((q) => q.customer_id).filter(Boolean))) as string[];
    const leadIds = Array.from(new Set(rows.map((q) => q.lead_id).filter(Boolean))) as string[];

    const [{ data: custs }, { data: lds }] = await Promise.all([
      custIds.length
        ? sb.from('customers').select('id, first_name, last_name').in('id', custIds)
        : Promise.resolve({ data: [] as Customer[] }),
      leadIds.length
        ? sb.from('leads').select('id, first_name, last_name').in('id', leadIds)
        : Promise.resolve({ data: [] as Lead[] }),
    ]);

    const customers: Record<string, Named> = {};
    for (const c of (custs ?? []) as Array<{ id: string } & Named>) {
      customers[c.id] = { first_name: c.first_name, last_name: c.last_name };
    }
    const leads: Record<string, Named> = {};
    for (const l of (lds ?? []) as Array<{ id: string } & Named>) {
      leads[l.id] = { first_name: l.first_name, last_name: l.last_name };
    }
    return { quotes: rows, customers, leads };
  } catch {
    return { quotes: [], customers: {}, leads: {} };
  }
}

function quoteName(
  q: Quote,
  customers: Record<string, Named>,
  leads: Record<string, Named>
): string {
  if (q.customer_id && customers[q.customer_id]) return fullName(customers[q.customer_id]);
  if (q.lead_id && leads[q.lead_id]) return fullName(leads[q.lead_id]);
  return 'Unassigned';
}

function lineSummary(items: QuoteLineItem[]): string {
  if (!items || items.length === 0) return '—';
  const first = items[0]?.label || 'Item';
  return items.length > 1 ? `${first} +${items.length - 1} more` : first;
}

export default async function QuotesPage() {
  const { quotes, customers, leads } = await getQuotes();
  const openCount = quotes.filter((q) => q.status === 'draft' || q.status === 'sent').length;

  return (
    <div>
      <PageHeader
        title="Quotes"
        subtitle={`${openCount} open · ${quotes.length} total`}
        actions={<NewQuoteButton />}
      />

      {quotes.length === 0 ? (
        <EmptyState
          title="No quotes yet"
          hint="Build a quote and send a shareable approval link to your prospect."
          action={<NewQuoteButton />}
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>For</Th>
              <Th>Summary</Th>
              <Th>One-time</Th>
              <Th>Recurring</Th>
              <Th>Created</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {quotes.map((q) => (
              <tr key={q.id} className="hover:bg-[#fafafa]">
                <Td>
                  <Link href={`/quotes/${q.id}`} className="font-heading font-bold text-ink hover:text-brand">
                    {quoteName(q, customers, leads)}
                  </Link>
                </Td>
                <Td className="text-sm text-muted">{lineSummary(q.line_items)}</Td>
                <Td className="text-sm">{money(q.subtotal)}</Td>
                <Td className="text-sm">
                  {q.recurring_amount != null
                    ? `${money(q.recurring_amount)}${q.recurring_interval ? ` / ${q.recurring_interval}` : ''}`
                    : '—'}
                </Td>
                <Td className="text-sm whitespace-nowrap">{shortDate(q.created_at)}</Td>
                <Td>
                  <StatusPill status={q.status} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
