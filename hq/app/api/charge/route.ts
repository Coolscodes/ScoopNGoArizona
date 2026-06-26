// Workstream 6 — Manual / weekly auto-charge.
// PORT of the repo-root /api/charge-customers.js, preserving its tested behavior:
//   - Monday–Sunday week (weekBounds), week label "Mon d - Mon d, YYYY".
//   - Only skip a customer if they already have a PAID invoice this week
//     (a 'sent' invoice does NOT cause a skip).
//   - Skip with a reason when: no price set, no Stripe customer, or no payment
//     method on file.
//   - Charge off_session via a PaymentIntent confirmed immediately.
//   - On success: update an existing 'sent' invoice for the week to 'paid'
//     (don't duplicate); otherwise insert a new 'paid' invoice. Also write a
//     `payments` row. Email the customer a receipt (to the verified inbox,
//     reply_to the customer).
//   - On decline / unexpected status / thrown error: email a failed-payment
//     alert to the owner. Email failures are non-fatal.
//
// Differences from the original (intentional, per WS6 conventions):
//   - Auth is CRON_SECRET (Bearer or x-cron-secret), not ADMIN_PASSWORD. Fail
//     closed if CRON_SECRET is unset.
//   - Uses the configured stripe() client and supabaseServer() (service role).
//   - Writes a payments row (the new schema tracks payments explicitly).

import { NextResponse } from 'next/server';
import { stripe, dollarsToCents } from '@/lib/stripe';
import { supabaseServer } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/auth';
import type { Customer, Invoice } from '@/lib/types';

export const dynamic = 'force-dynamic';

const OWNER_EMAIL = 'scoopngoarizona@gmail.com';
const FROM = 'Scoop N Go Arizona <onboarding@resend.dev>';

// --- auth ------------------------------------------------------------------

// Authorized when EITHER the CRON_SECRET is presented (Bearer or x-cron-secret;
// used by Vercel cron) OR a logged-in staff session exists (the "Charge now"
// button in the authed app). The secret is never exposed to the browser, so the
// UI relies on the session path.
function hasCronSecret(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed if unset
  const auth = request.headers.get('authorization');
  const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : '';
  const header = request.headers.get('x-cron-secret') || '';
  return bearer === secret || header === secret;
}

async function authorized(request: Request): Promise<boolean> {
  if (hasCronSecret(request)) return true;
  try {
    return Boolean(await getCurrentUser());
  } catch {
    return false;
  }
}

// --- week helpers (Monday week, matching the original) ----------------------

interface WeekInfo {
  periodStart: string; // YYYY-MM-DD (Monday)
  periodEnd: string; // YYYY-MM-DD (Sunday)
  weekLabel: string; // "Jun 9 - Jun 15, 2026"
  monday: Date;
  sunday: Date;
}

function currentWeek(now: Date = new Date()): WeekInfo {
  const day = now.getDay(); // 0=Sun, 1=Mon...
  const diffToMon = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMon);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const fmtLabel = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return {
    periodStart: fmt(monday),
    periodEnd: fmt(sunday),
    weekLabel: `${fmtLabel(monday)} - ${fmtLabel(sunday)}, ${monday.getFullYear()}`,
    monday,
    sunday,
  };
}

// Due date = the customer's service day this week, or Friday if none set,
// clamped to within the week. Matches the original exactly.
function dueDateFor(c: Customer, week: WeekInfo): string {
  const dayMap: Record<string, number> = {
    Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
  };
  const serviceDayNum = (c.preferred_day ? dayMap[c.preferred_day] : undefined) ?? 5;
  const dueDate = new Date(week.monday);
  dueDate.setDate(week.monday.getDate() + ((serviceDayNum - 1 + 7) % 7));
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  return fmt(dueDate <= week.sunday ? dueDate : week.sunday);
}

// --- emails (verbatim copy of the original templates) -----------------------

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
    // Non-fatal — don't let email failure block the rest.
  }
}

async function sendReceiptEmail(c: Customer, weekLabel: string): Promise<void> {
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
        subject: `Receipt: Scoop N Go Arizona - Week of ${weekLabel}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:20px;">
            <h2 style="color:#1b5e20;">Payment Receipt</h2>
            <p>Hi ${c.first_name},</p>
            <p>Your card on file was charged for your weekly yard cleaning service. Here's your receipt:</p>
            <table style="width:100%;border-collapse:collapse;margin:20px 0;">
              <tr><td style="padding:8px 0;color:#555;">Service Week</td><td style="padding:8px 0;font-weight:bold;">${weekLabel}</td></tr>
              <tr><td style="padding:8px 0;color:#555;">Service Type</td><td style="padding:8px 0;">${c.service_type || 'Weekly'}</td></tr>
              <tr><td style="padding:8px 0;color:#555;">Amount Charged</td><td style="padding:8px 0;font-weight:bold;color:#1b5e20;">$${(c.price_per_visit ?? 0).toFixed(2)}</td></tr>
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

// --- result types -----------------------------------------------------------

type ChargeResult =
  | { name: string; status: 'charged'; amount: number }
  | { name: string; status: 'skipped'; reason: string }
  | { name: string; status: 'failed'; reason: string };

// --- handler ----------------------------------------------------------------

export async function POST(request: Request) {
  if (!(await authorized(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { customer_ids?: unknown } = {};
  try {
    body = (await request.json()) as { customer_ids?: unknown };
  } catch {
    // Empty body is allowed below; treated as no selection.
  }

  const customerIds = Array.isArray(body.customer_ids)
    ? (body.customer_ids as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];

  const week = currentWeek();

  if (!customerIds.length) {
    return NextResponse.json({ error: 'No customers selected' }, { status: 400 });
  }

  const sb = supabaseServer();
  const sk = stripe();

  // Fetch only the selected customers.
  const { data: custData } = await sb
    .from('customers')
    .select('*')
    .in('id', customerIds)
    .order('first_name', { ascending: true });
  const customers = (custData ?? []) as Customer[];

  if (!customers.length) {
    return NextResponse.json({
      message: 'No customers found',
      week: week.weekLabel,
      results: [],
    });
  }

  // Only skip if already PAID this week — don't skip "sent" invoices.
  const { data: paidData } = await sb
    .from('invoices')
    .select('customer_id')
    .eq('period_start', week.periodStart)
    .eq('status', 'paid');
  const alreadyPaid = new Set(
    ((paidData ?? []) as { customer_id: string }[]).map((i) => i.customer_id)
  );

  const results: ChargeResult[] = [];

  for (const c of customers) {
    const name = `${c.first_name} ${c.last_name}`.trim();

    if (alreadyPaid.has(c.id)) {
      results.push({ name, status: 'skipped', reason: 'Already charged this week' });
      continue;
    }
    if (!c.price_per_visit) {
      results.push({ name, status: 'skipped', reason: 'No price set' });
      continue;
    }
    if (!c.stripe_customer_id) {
      results.push({ name, status: 'skipped', reason: 'No card on file' });
      continue;
    }

    const amountCents = dollarsToCents(c.price_per_visit);

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
        results.push({
          name,
          status: 'skipped',
          reason: 'No payment method found — send card setup link',
        });
        continue;
      }

      // Charge the card off-session, confirming immediately.
      const pi = await sk.paymentIntents.create({
        amount: amountCents,
        currency: 'usd',
        customer: c.stripe_customer_id,
        payment_method: pmId,
        confirm: true,
        off_session: true,
        description: `Scoop N Go Arizona - Week of ${week.weekLabel}`,
        metadata: {
          customer_id: c.id,
          customer_name: name,
          period_start: week.periodStart,
        },
      });

      if (pi.status === 'succeeded') {
        const dueDateStr = dueDateFor(c, week);

        // Update an existing 'sent' invoice for this week to 'paid' instead of
        // creating a duplicate; otherwise insert a fresh paid invoice.
        const { data: sentData } = await sb
          .from('invoices')
          .select('*')
          .eq('customer_id', c.id)
          .eq('period_start', week.periodStart)
          .eq('status', 'sent')
          .limit(1);
        const existingInv = ((sentData ?? []) as Invoice[])[0];

        let invoiceId: string | undefined;
        if (existingInv) {
          const { data: upd } = await sb
            .from('invoices')
            .update({
              status: 'paid',
              notes: `Week of ${week.weekLabel} - charged to card on file`,
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
              amount: c.price_per_visit,
              status: 'paid',
              due_date: dueDateStr,
              period_start: week.periodStart,
              period_end: week.periodEnd,
              notes: `Week of ${week.weekLabel} - charged to card on file`,
              stripe_payment_intent_id: pi.id,
            })
            .select('id')
            .single();
          invoiceId = (ins as { id: string } | null)?.id;
        }

        // Record the payment (new schema tracks these explicitly).
        if (invoiceId) {
          await sb.from('payments').insert({
            invoice_id: invoiceId,
            amount: c.price_per_visit,
            method: 'card',
            paid_at: new Date().toISOString(),
            notes: `Stripe ${pi.id}`,
          });
        }

        await sendReceiptEmail(c, week.weekLabel);

        results.push({ name, status: 'charged', amount: c.price_per_visit });
      } else if (
        pi.status === 'requires_action' ||
        pi.status === 'requires_payment_method'
      ) {
        const reason = `Card declined or requires action (${pi.status})`;
        await sendFailureEmail(name, c.phone, c.price_per_visit, reason, week.weekLabel);
        results.push({ name, status: 'failed', reason });
      } else {
        const reason = `Unexpected status: ${pi.status}`;
        await sendFailureEmail(name, c.phone, c.price_per_visit, reason, week.weekLabel);
        results.push({ name, status: 'failed', reason });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Charge failed';
      await sendFailureEmail(name, c.phone, c.price_per_visit ?? 0, reason, week.weekLabel);
      results.push({ name, status: 'failed', reason });
    }
  }

  const charged = results.filter((r) => r.status === 'charged').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  const total = results
    .filter((r): r is Extract<ChargeResult, { status: 'charged' }> => r.status === 'charged')
    .reduce((s, r) => s + (r.amount || 0), 0);

  return NextResponse.json({
    week: week.weekLabel,
    charged,
    failed,
    skipped,
    total,
    results,
  });
}
