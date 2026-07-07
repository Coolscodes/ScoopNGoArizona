// PUBLIC quote approval page, /quote/[token]. No auth (middleware exempts /quote/).
// Reads the quote server-side via the service-role client, scoped to the opaque token.
// Never renders staff data or exposes any key to the browser.

import { supabaseServer } from '@/lib/supabase';
import { money } from '@/lib/format';
import { QuoteApproval } from '@/components/quotes/QuoteApproval';
import type { Quote } from '@/lib/types';

export const dynamic = 'force-dynamic';

async function getQuote(token: string): Promise<Quote | null> {
  try {
    const { data } = await supabaseServer()
      .from('quotes')
      .select('*')
      .eq('public_token', token)
      .maybeSingle();
    return (data as Quote) ?? null;
  } catch {
    return null;
  }
}

function NotFound() {
  return (
    <main className="min-h-screen bg-tan flex items-center justify-center px-4">
      <div className="bg-white rounded-card border border-line p-8 max-w-md text-center">
        <h1 className="font-heading font-black text-xl text-ink">Quote not found</h1>
        <p className="text-sm text-muted mt-2">
          This link may be incorrect or expired. Please contact Scoop N Go for an updated quote.
        </p>
      </div>
    </main>
  );
}

export default async function PublicQuotePage({ params }: { params: { token: string } }) {
  const quote = await getQuote(params.token);
  if (!quote) return <NotFound />;

  // Draft quotes have not been sent, don't expose them publicly.
  if (quote.status === 'draft') return <NotFound />;

  const oneTime = (quote.line_items ?? []).filter((l) => !l.recurring);
  const recurringLines = (quote.line_items ?? []).filter((l) => l.recurring);

  return (
    <main className="min-h-screen bg-tan py-10 px-4">
      <div className="max-w-xl mx-auto">
        <div className="text-center mb-6">
          <div className="font-heading font-black text-2xl text-brand-dark">Scoop N Go Arizona</div>
          <p className="text-sm text-muted mt-1">Your service quote</p>
        </div>

        <div className="bg-white rounded-card border border-line overflow-hidden">
          <div className="px-6 py-5 border-b border-line">
            <h1 className="font-heading font-bold text-lg text-ink">Quote details</h1>
          </div>

          <div className="px-6 py-5">
            {oneTime.length === 0 && recurringLines.length === 0 ? (
              <p className="text-sm text-muted">No line items on this quote.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {oneTime.map((l, i) => (
                    <tr key={`o${i}`} className="border-b border-line">
                      <td className="py-2.5 text-ink">{l.label || 'Item'}</td>
                      <td className="py-2.5 text-right font-heading font-bold">{money(l.amount)}</td>
                    </tr>
                  ))}
                  {recurringLines.map((l, i) => (
                    <tr key={`r${i}`} className="border-b border-line">
                      <td className="py-2.5 text-ink">
                        {l.label || 'Item'}
                        <span className="text-xs text-muted ml-1">(recurring)</span>
                      </td>
                      <td className="py-2.5 text-right font-heading font-bold">{money(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="flex items-center justify-between mt-4 pt-4 border-t-2 border-line">
              <span className="font-heading font-bold text-ink">One-time total</span>
              <span className="font-heading font-black text-xl text-brand-dark">
                {money(quote.subtotal)}
              </span>
            </div>

            {quote.recurring_amount != null && (
              <div className="flex items-center justify-between mt-2 text-sm">
                <span className="text-muted">Ongoing service</span>
                <span className="font-heading font-bold">
                  {money(quote.recurring_amount)}
                  {quote.recurring_interval ? ` / ${quote.recurring_interval}` : ''}
                </span>
              </div>
            )}

            {quote.notes && (
              <p className="text-sm text-muted mt-4 whitespace-pre-line">{quote.notes}</p>
            )}
          </div>

          <div className="px-6 py-5 bg-tan border-t border-line">
            <QuoteApproval token={quote.public_token} initialStatus={quote.status} />
          </div>
        </div>

        <p className="text-center text-xs text-muted mt-6">
          Questions? Reply to the message we sent you and we&apos;ll help right away.
        </p>
      </div>
    </main>
  );
}
