// Shared card-charging core, used by POST /api/charge (bulk weekly run) and by
// the charge-on-completion hooks in /api/route and /api/visits. Server-only:
// touches Stripe with the secret key and Supabase with the service role.
//
// Behavior preserved from the original charge flow:
//   - Monday-to-Sunday week; label "Jun 29 to Jul 5, 2026".
//   - Saved default payment method, falling back to the first card.
//   - Off-session PaymentIntent confirmed immediately.
//   - Success: update an existing 'sent' invoice for the week to 'paid' (no
//     duplicates) or insert a fresh paid invoice; write a payments row; email
//     the customer a receipt.
//   - Failure: email the owner an alert AND record a 'sent' invoice for the
//     week (when none exists) so the debt shows in AR with retry buttons.

import type Stripe from 'stripe';
import { stripe, dollarsToCents } from './stripe';
import { supabaseServer } from './supabase';
import type { Customer, Invoice } from './types';

const OWNER_EMAIL = 'scoopngoarizona@gmail.com';
const FROM = 'Scoop N Go Arizona <onboarding@resend.dev>';

type Supa = ReturnType<typeof supabaseServer>;

// --- week helpers (Monday week) ----------------------------------------------

export interface WeekInfo {
  periodStart: string; // YYYY-MM-DD (Monday)
  periodEnd: string; // YYYY-MM-DD (Sunday)
  weekLabel: string; // "Jun 29 to Jul 5, 2026"
  monday: Date;
  sunday: Date;
}

export function currentWeek(now: Date = new Date()): WeekInfo {
  const day = now.getDay(); // 0=Sun, 1=Mon...
  const diffToMon = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMon);
  return weekFromMonday(monday);
}

function weekFromMonday(monday: Date): WeekInfo {
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const fmtLabel = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return {
    periodStart: fmt(monday),
    periodEnd: fmt(sunday),
    weekLabel: `${fmtLabel(monday)} to ${fmtLabel(sunday)}, ${monday.getFullYear()}`,
    monday,
    sunday,
  };
}

// WeekInfo for a stored invoice period_start (YYYY-MM-DD). Parsed as a local
// date so the label never shifts a day across timezones. Works for any start
// date, not just Mondays, since some hand-made invoices have odd bounds.
export function weekFromPeriodStart(periodStart: string): WeekInfo {
  const [y, m, d] = periodStart.split('-').map(Number);
  return weekFromMonday(new Date(y, m - 1, d));
}

// The customer's oldest unpaid ('sent' or 'overdue') invoice, by period. This
// is the week a new payment should apply to, so money always knocks out the
// oldest debt first instead of stamping the current week.
export async function oldestOpenInvoice(
  sb: Supa,
  customerId: string
): Promise<Invoice | null> {
  const { data } = await sb
    .from('invoices')
    .select('*')
    .eq('customer_id', customerId)
    .in('status', ['sent', 'overdue'])
    .order('period_start', { ascending: true, nullsFirst: false })
    .limit(1);
  return ((data ?? []) as Invoice[])[0] ?? null;
}

// Due date = the customer's service day this week, or Friday if none set,
// clamped to within the week.
export function dueDateFor(c: Customer, week: WeekInfo): string {
  const dayMap: Record<string, number> = {
    Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
  };
  const serviceDayNum = (c.preferred_day ? dayMap[c.preferred_day] : undefined) ?? 5;
  const dueDate = new Date(week.monday);
  dueDate.setDate(week.monday.getDate() + ((serviceDayNum - 1 + 7) % 7));
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  return fmt(dueDate <= week.sunday ? dueDate : week.sunday);
}

// --- emails -------------------------------------------------------------------

async function sendFailureEmail(
  customerName: string,
  phone: string | undefined,
  amount: number,
  reason: string,
  weekLabel: string
): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: OWNER_EMAIL,
        subject: `⚠️ Payment Failed: ${customerName}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:20px;">
            <h2 style="color:#c62828;">⚠️ Payment Failed</h2>
            <p>A charge did not go through for the following client:</p>
            <table style="width:100%;border-collapse:collapse;margin:16px 0;">
              <tr><td style="padding:8px 0;color:#555;">Client</td><td style="padding:8px 0;font-weight:bold;">${customerName}</td></tr>
              <tr><td style="padding:8px 0;color:#555;">Phone</td><td style="padding:8px 0;">${phone || 'N/A'}</td></tr>
              <tr><td style="padding:8px 0;color:#555;">Amount</td><td style="padding:8px 0;font-weight:bold;">$${(amount || 0).toFixed(2)}</td></tr>
              <tr><td style="padding:8px 0;color:#555;">Week</td><td style="padding:8px 0;">${weekLabel}</td></tr>
              <tr><td style="padding:8px 0;color:#555;">Reason</td><td style="padding:8px 0;color:#c62828;">${reason}</td></tr>
            </table>
            <p>You may need to send them a new card setup link or follow up directly.</p>
            <a href="https://www.scoopngoarizona.com/admin" style="display:inline-block;background:#1b5e20;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold;">Open Admin</a>
          </div>
        `,
      }),
    });
  } catch {
    // Non-fatal, don't let email failure block the rest.
  }
}

async function sendReceiptEmail(
  c: Customer,
  weekLabel: string,
  amount: number
): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey || !c.email) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        // Resend restriction: can only send to the verified email in test mode.
        to: OWNER_EMAIL,
        reply_to: c.email,
        subject: `Receipt: Scoop N Go Arizona: Week of ${weekLabel}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:20px;">
            <h2 style="color:#1b5e20;">Payment Receipt</h2>
            <p>Hi ${c.first_name},</p>
            <p>Your card on file was charged for your weekly yard cleaning service. Here's your receipt:</p>
            <table style="width:100%;border-collapse:collapse;margin:20px 0;">
              <tr><td style="padding:8px 0;color:#555;">Service Week</td><td style="padding:8px 0;font-weight:bold;">${weekLabel}</td></tr>
              <tr><td style="padding:8px 0;color:#555;">Service Type</td><td style="padding:8px 0;">${c.service_type || 'Weekly'}</td></tr>
              <tr><td style="padding:8px 0;color:#555;">Amount Charged</td><td style="padding:8px 0;font-weight:bold;color:#1b5e20;">$${amount.toFixed(2)}</td></tr>
            </table>
            <p style="color:#555;font-size:14px;">Thank you for choosing Scoop N Go Arizona! 🐾</p>
            <p style="color:#555;font-size:14px;">Questions? Reply to this email or text us anytime.</p>
            <hr style="border:none;border-top:1px solid #eee;margin:20px 0;"/>
            <p style="color:#aaa;font-size:12px;">Scoop N Go Arizona | East Valley, AZ | scoopngoarizona@gmail.com</p>
          </div>
        `,
      }),
    });
  } catch {
    // Non-fatal.
  }
}

// --- invoices -----------------------------------------------------------------

// A failed charge still means the week is owed. Record a 'sent' invoice for
// the period (unless one already exists for it) so AR shows the balance and
// the retry buttons on /invoices can pick it up.
async function recordFailedChargeInvoice(
  sb: Supa,
  c: Customer,
  week: WeekInfo,
  amount: number,
  reason: string
): Promise<void> {
  try {
    const { data } = await sb
      .from('invoices')
      .select('id')
      .eq('customer_id', c.id)
      .eq('period_start', week.periodStart)
      .limit(1);
    if ((data ?? []).length > 0) return;
    await sb.from('invoices').insert({
      customer_id: c.id,
      amount,
      status: 'sent',
      due_date: dueDateFor(c, week),
      period_start: week.periodStart,
      period_end: week.periodEnd,
      notes: `Week of ${week.weekLabel}, card charge failed: ${reason}`,
    });
  } catch {
    // Non-fatal; the failure email already went out.
  }
}

// --- core charge --------------------------------------------------------------

export type ChargeResult =
  | { name: string; status: 'charged'; amount: number; week?: string }
  | { name: string; status: 'skipped'; reason: string }
  | { name: string; status: 'failed'; reason: string };

// Charge one customer's card for the given week and amount, with all side
// effects (invoice upsert, payments row, receipt / failure email, AR record on
// decline). Callers are responsible for eligibility (card on file, not already
// paid this week); this function assumes the charge should be attempted.
export async function chargeCustomerForWeek(
  sb: Supa,
  sk: Stripe,
  c: Customer,
  week: WeekInfo,
  amount: number
): Promise<ChargeResult> {
  const name = `${c.first_name} ${c.last_name}`.trim();

  if (!c.stripe_customer_id) {
    return { name, status: 'skipped', reason: 'No card on file' };
  }

  try {
    // Saved default payment method; fall back to first card on the customer.
    const stripeCust = await sk.customers.retrieve(c.stripe_customer_id);
    let pmId: string | undefined;
    if (!('deleted' in stripeCust)) {
      const dpm = stripeCust.invoice_settings?.default_payment_method;
      pmId = typeof dpm === 'string' ? dpm : dpm?.id;
    }
    if (!pmId) {
      const pms = await sk.paymentMethods.list({
        customer: c.stripe_customer_id,
        type: 'card',
      });
      pmId = pms.data[0]?.id;
    }
    if (!pmId) {
      return {
        name,
        status: 'skipped',
        reason: 'No payment method found, send card setup link',
      };
    }

    // Charge the card off-session, confirming immediately.
    const pi = await sk.paymentIntents.create({
      amount: dollarsToCents(amount),
      currency: 'usd',
      customer: c.stripe_customer_id,
      payment_method: pmId,
      confirm: true,
      off_session: true,
      description: `Scoop N Go Arizona: Week of ${week.weekLabel}`,
      metadata: {
        customer_id: c.id,
        customer_name: name,
        period_start: week.periodStart,
      },
    });

    if (pi.status === 'succeeded') {
      const dueDateStr = dueDateFor(c, week);

      // Update an existing open invoice for this week to 'paid' instead of
      // creating a duplicate; otherwise insert a fresh paid invoice.
      const { data: sentData } = await sb
        .from('invoices')
        .select('*')
        .eq('customer_id', c.id)
        .eq('period_start', week.periodStart)
        .in('status', ['sent', 'overdue'])
        .limit(1);
      const existingInv = ((sentData ?? []) as Invoice[])[0];

      let invoiceId: string | undefined;
      if (existingInv) {
        const { data: upd } = await sb
          .from('invoices')
          .update({
            status: 'paid',
            amount,
            notes: `Week of ${week.weekLabel}, charged to card on file`,
            stripe_payment_intent_id: pi.id,
          })
          .eq('id', existingInv.id)
          .select('id')
          .single();
        invoiceId = (upd as { id: string } | null)?.id ?? existingInv.id;
      } else {
        const { data: ins } = await sb
          .from('invoices')
          .insert({
            customer_id: c.id,
            amount,
            status: 'paid',
            due_date: dueDateStr,
            period_start: week.periodStart,
            period_end: week.periodEnd,
            notes: `Week of ${week.weekLabel}, charged to card on file`,
            stripe_payment_intent_id: pi.id,
          })
          .select('id')
          .single();
        invoiceId = (ins as { id: string } | null)?.id;
      }

      // Record the payment (the schema tracks these explicitly).
      if (invoiceId) {
        await sb.from('payments').insert({
          invoice_id: invoiceId,
          amount,
          method: 'card',
          paid_at: new Date().toISOString(),
          notes: `Stripe ${pi.id}`,
        });
      }

      await sendReceiptEmail(c, week.weekLabel, amount);

      return { name, status: 'charged', amount, week: week.weekLabel };
    }

    const reason =
      pi.status === 'requires_action' || pi.status === 'requires_payment_method'
        ? `Card declined or requires action (${pi.status})`
        : `Unexpected status: ${pi.status}`;
    await sendFailureEmail(name, c.phone, amount, reason, week.weekLabel);
    await recordFailedChargeInvoice(sb, c, week, amount, reason);
    return { name, status: 'failed', reason };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Charge failed';
    await sendFailureEmail(name, c.phone, amount, reason, week.weekLabel);
    await recordFailedChargeInvoice(sb, c, week, amount, reason);
    return { name, status: 'failed', reason };
  }
}

// --- charge on completion -----------------------------------------------------

export interface AutoChargeOutcome {
  attempted: boolean;
  reason?: string; // why nothing was attempted
  result?: ChargeResult; // set when attempted
}

// Called when a visit is marked completed (route page, dashboard, field tool).
// Charges the client's standing price IF they opted in (customers.auto_charge)
// and the week isn't already paid. Never throws; completion must always succeed
// even when billing has a problem.
export async function autoChargeOnCompletion(
  customerId: string
): Promise<AutoChargeOutcome> {
  try {
    const sb = supabaseServer();
    const { data } = await sb
      .from('customers')
      .select('*')
      .eq('id', customerId)
      .single();
    const c = data as Customer | null;

    if (!c) return { attempted: false, reason: 'Client not found' };
    if (!c.auto_charge) return { attempted: false, reason: 'Auto-charge not enabled' };
    if (!c.stripe_customer_id) return { attempted: false, reason: 'No card on file' };
    if (!c.price_per_visit) return { attempted: false, reason: 'No price set' };

    const week = currentWeek();
    const { data: paid } = await sb
      .from('invoices')
      .select('id')
      .eq('customer_id', c.id)
      .eq('period_start', week.periodStart)
      .eq('status', 'paid')
      .limit(1);
    if ((paid ?? []).length > 0) {
      return { attempted: false, reason: 'Already paid this week' };
    }

    // A visit just happened, so this week is owed. Put it on the books as a
    // 'sent' invoice (if not already invoiced) BEFORE charging, so that when
    // the payment applies to an older owed week the current week's debt stays
    // visible instead of silently disappearing.
    const { data: existing } = await sb
      .from('invoices')
      .select('id')
      .eq('customer_id', c.id)
      .eq('period_start', week.periodStart)
      .limit(1);
    if ((existing ?? []).length === 0) {
      await sb.from('invoices').insert({
        customer_id: c.id,
        amount: c.price_per_visit,
        status: 'sent',
        due_date: dueDateFor(c, week),
        period_start: week.periodStart,
        period_end: week.periodEnd,
        notes: `Week of ${week.weekLabel} - ${c.service_type || 'Visit'}`,
      });
    }

    // Pay the oldest owed week first (which is the current week when the
    // client is caught up).
    const open = await oldestOpenInvoice(sb, c.id);
    const targetWeek = open?.period_start ? weekFromPeriodStart(open.period_start) : week;
    const amount = open?.amount ? Number(open.amount) : c.price_per_visit;

    const sk = stripe();
    const result = await chargeCustomerForWeek(sb, sk, c, targetWeek, amount);
    return { attempted: true, result };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Auto-charge failed';
    return {
      attempted: true,
      result: { name: '', status: 'failed', reason },
    };
  }
}
