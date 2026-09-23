// Writing the signup weeks onto the books. Server-only.
//
// Shared by the two ways the signup money can arrive: the hosted $60 link
// (/api/signup/confirm, after Stripe says it was paid) and money taken any
// other way (/api/signup/collect). Both end up here so the invoices look
// identical however she paid.
//
// One invoice per covered week, never one wide invoice, because the
// auto-charge and the weekly run both look for a PAID invoice whose
// period_start is exactly that Monday. See the note in the collect route.

import type { supabaseServer } from './supabase';
import type { Customer, Invoice, PayMethod } from './types';
import type { CoveredVisit } from './signup-plan';

type Supa = ReturnType<typeof supabaseServer>;

export interface BookedVisit extends CoveredVisit {
  booked: 'created' | 'updated' | 'already paid';
}

export interface BookingResult {
  weeks: BookedVisit[];
  problems: string[];
}

export type WeekStatus = Map<string, { id: string; status: string }>;

// What is already on the books for these weeks, so a second run neither
// double-charges nor double-books.
export async function invoiceStatusByWeek(
  sb: Supa,
  customerId: string,
  periodStarts: string[]
): Promise<WeekStatus> {
  const out: WeekStatus = new Map();
  if (!periodStarts.length) return out;
  const { data } = await sb
    .from('invoices')
    .select('id, status, period_start')
    .eq('customer_id', customerId)
    .in('period_start', periodStarts);
  for (const inv of (data ?? []) as Pick<Invoice, 'id' | 'status' | 'period_start'>[]) {
    if (inv.period_start) out.set(inv.period_start, { id: inv.id, status: inv.status });
  }
  return out;
}

export interface BookingOptions {
  method: PayMethod;
  label: string; // e.g. "$60.00 signup", used in the invoice and payment notes
  reference?: string; // Stripe PaymentIntent id when there is one
}

// Marks each covered week paid and records the payment against it. Weeks that
// are already paid are left alone. Never throws: by the time this runs the
// money is usually already taken, so a bad week is reported, not raised.
export async function bookCoveredWeeks(
  sb: Supa,
  customer: Customer,
  weeks: CoveredVisit[],
  options: BookingOptions,
  known?: WeekStatus
): Promise<BookingResult> {
  const existing =
    known ?? (await invoiceStatusByWeek(sb, customer.id, weeks.map((w) => w.periodStart)));

  const booked: BookedVisit[] = [];
  const problems: string[] = [];

  for (const week of weeks) {
    const row = existing.get(week.periodStart);
    if (row?.status === 'paid') {
      booked.push({ ...week, booked: 'already paid' });
      continue;
    }
    const notes = week.free
      ? `Week of ${week.weekLabel}, first visit free (signup offer)`
      : `Week of ${week.weekLabel}, prepaid in the ${options.label}`;

    try {
      let invoiceId: string;
      if (row) {
        const { error } = await sb
          .from('invoices')
          .update({ status: 'paid', amount: week.amount, notes })
          .eq('id', row.id);
        if (error) throw error;
        invoiceId = row.id;
        booked.push({ ...week, booked: 'updated' });
      } else {
        const { data, error } = await sb
          .from('invoices')
          .insert({
            customer_id: customer.id,
            amount: week.amount,
            status: 'paid',
            due_date: week.visitDate,
            period_start: week.periodStart,
            period_end: week.periodEnd,
            notes,
            ...(options.reference ? { stripe_payment_intent_id: options.reference } : {}),
          })
          .select('id')
          .single();
        if (error) throw error;
        invoiceId = (data as { id: string }).id;
        booked.push({ ...week, booked: 'created' });
      }

      // The free week gets no payments row: no money changed hands for it.
      if (week.amount > 0) {
        await sb.from('payments').insert({
          invoice_id: invoiceId,
          amount: week.amount,
          method: options.method,
          paid_at: new Date().toISOString(),
          notes: options.reference
            ? `${options.label}, Stripe ${options.reference}`
            : `${options.label}, recorded in HQ (${options.method})`,
        });
      }
    } catch (err) {
      problems.push(`${week.weekLabel}: ${err instanceof Error ? err.message : 'write failed'}`);
    }
  }

  return { weeks: booked, problems };
}
