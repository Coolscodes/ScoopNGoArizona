import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { QuoteBuilder } from '@/components/quotes/QuoteBuilder';
import { supabaseServer } from '@/lib/supabase';
import { fullName, shortDate } from '@/lib/format';
import type { Quote, Customer, Lead } from '@/lib/types';

export const dynamic = 'force-dynamic';

async function getQuote(id: string): Promise<{ quote: Quote | null; forName: string }> {
  const sb = supabaseServer();
  const { data } = await sb.from('quotes').select('*').eq('id', id).maybeSingle();
  const quote = (data as Quote) ?? null;
  if (!quote) return { quote: null, forName: '' };

  let forName = '';
  if (quote.customer_id) {
    const { data: c } = await sb
      .from('customers')
      .select('first_name, last_name')
      .eq('id', quote.customer_id)
      .maybeSingle();
    if (c) forName = fullName(c as Customer);
  } else if (quote.lead_id) {
    const { data: l } = await sb
      .from('leads')
      .select('first_name, last_name')
      .eq('id', quote.lead_id)
      .maybeSingle();
    if (l) forName = fullName(l as Lead);
  }
  return { quote, forName };
}

export default async function QuoteDetailPage({ params }: { params: { id: string } }) {
  const { quote, forName } = await getQuote(params.id);
  if (!quote) notFound();

  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '') || '';

  return (
    <div>
      <Link href="/quotes" className="text-sm text-muted hover:text-brand">
        ← All quotes
      </Link>
      <div className="mt-2">
        <PageHeader
          title={forName ? `Quote for ${forName}` : 'Quote'}
          subtitle={`Created ${shortDate(quote.created_at)}`}
        />
      </div>
      <QuoteBuilder quote={quote} baseUrl={baseUrl} />
    </div>
  );
}
