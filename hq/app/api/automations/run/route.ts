// Workstream 8, Automations cron runner (the messaging engine).
//
// POST /api/automations/run
//   Auth: send the CRON_SECRET either as
//     Authorization: Bearer <CRON_SECRET>   or   x-cron-secret: <CRON_SECRET>
//   -> 200 { ran: true, today, results: {...} }
//   -> 401 if the secret is missing/wrong (fails CLOSED when CRON_SECRET is unset).
//
// What it does (each gated by its automations toggle being enabled):
//   • review_request, when a customer has reached 4 completed visits, send a one-time
//                       review-request text. Idempotent: skipped if a 'review_request'
//                       notification already exists for that customer.
//   • on_my_way, used here as the umbrella toggle for proactive client texts:
//                       send a next-day appointment reminder for tomorrow's scheduled
//                       stops. Idempotent: skipped if a 'reminder' notification already
//                       exists for that appointment_id.
//
// Sending + logging goes through sendSms() and writes a `notifications` row directly
// (server-side) so the cron is self-contained. If Twilio is not configured, every
// would-be send is logged as status='skipped' and reported, without crashing.
//
// Idempotency relies on the `notifications` table: we record each send keyed by
// customer_id (review) or appointment_id (reminder), and check for an existing row
// before sending. Re-running the endpoint is safe.

import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { todayISO } from '@/lib/format';
import { sendSms, isTwilioConfigured } from '@/lib/twilio';
import type { Appointment, Automation, Customer } from '@/lib/types';

export const dynamic = 'force-dynamic';

const REVIEW_VISIT_THRESHOLD = 4;
const REVIEW_URL = process.env.NEXT_PUBLIC_REVIEW_URL || 'our Google page';

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed if not configured
  const auth = request.headers.get('authorization');
  const bearer = auth?.toLowerCase().startsWith('bearer ')
    ? auth.slice(7).trim()
    : null;
  const headerSecret = request.headers.get('x-cron-secret');
  return bearer === secret || headerSecret === secret;
}

function addDaysISO(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

type Sb = ReturnType<typeof supabaseServer>;

// Send one SMS and log a notifications row. Returns the outcome status.
// Never throws, failures are captured as 'failed' so one bad number can't abort
// the whole cron run.
async function sendAndLog(
  sb: Sb,
  opts: {
    to: string | null | undefined;
    body: string;
    customer_id: string;
    type: string;
    appointment_id?: string;
  }
): Promise<'sent' | 'skipped' | 'failed' | 'no_phone'> {
  if (!opts.to) return 'no_phone';

  let status: 'sent' | 'skipped' | 'failed' = 'skipped';
  if (isTwilioConfigured()) {
    try {
      await sendSms(opts.to, opts.body);
      status = 'sent';
    } catch {
      status = 'failed';
    }
  }

  try {
    await sb.from('notifications').insert({
      customer_id: opts.customer_id,
      type: opts.type,
      channel: 'sms',
      message: opts.body,
      status,
      appointment_id: opts.appointment_id ?? null,
      sent_at: new Date().toISOString(),
    });
  } catch {
    // Logging failure shouldn't change the send outcome.
  }
  return status;
}

function isEnabled(map: Map<string, Automation>, key: string): boolean {
  return map.get(key)?.enabled === true;
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const today = todayISO();

  try {
    const sb = supabaseServer();

    // Respect the on/off toggles.
    const { data: autoData, error: autoErr } = await sb.from('automations').select('*');
    if (autoErr) throw autoErr;
    const autos = new Map<string, Automation>(
      ((autoData ?? []) as Automation[]).map((a) => [a.key, a])
    );

    const twilioConfigured = isTwilioConfigured();

    const results = {
      twilio_configured: twilioConfigured,
      review_request: {
        enabled: isEnabled(autos, 'review_request'),
        sent: 0,
        skipped: 0,
        failed: 0,
      },
      reminders: {
        enabled: isEnabled(autos, 'on_my_way'),
        date: addDaysISO(today, 1),
        sent: 0,
        skipped: 0,
        failed: 0,
        no_phone: 0,
      },
    };

    // ---- Review requests: customers who have hit the completed-visit threshold ----
    if (results.review_request.enabled) {
      // Completed appointments tell us how many visits each customer has had.
      const { data: completed, error: cErr } = await sb
        .from('appointments')
        .select('customer_id')
        .eq('status', 'completed');
      if (cErr) throw cErr;

      const counts = new Map<string, number>();
      for (const a of (completed ?? []) as Pick<Appointment, 'customer_id'>[]) {
        counts.set(a.customer_id, (counts.get(a.customer_id) ?? 0) + 1);
      }
      const eligibleIds = Array.from(counts.entries())
        .filter(([, n]) => n >= REVIEW_VISIT_THRESHOLD)
        .map(([id]) => id);

      if (eligibleIds.length > 0) {
        // Who has already been asked? (one review request per customer, ever)
        const { data: already, error: aErr } = await sb
          .from('notifications')
          .select('customer_id')
          .eq('type', 'review_request')
          .in('customer_id', eligibleIds);
        if (aErr) throw aErr;
        const asked = new Set(
          ((already ?? []) as { customer_id: string }[]).map((r) => r.customer_id)
        );

        const toAsk = eligibleIds.filter((id) => !asked.has(id));
        if (toAsk.length > 0) {
          const { data: custs, error: custErr } = await sb
            .from('customers')
            .select('id, first_name, phone, active')
            .in('id', toAsk);
          if (custErr) throw custErr;

          for (const c of (custs ?? []) as Pick<
            Customer,
            'id' | 'first_name' | 'phone' | 'active'
          >[]) {
            if (c.active === false) continue;
            const name = c.first_name ? ` ${c.first_name}` : '';
            const body = `Hi${name}, thanks for being a Scoop N Go client! If you've been happy with our service, would you mind leaving us a quick review? ${REVIEW_URL}`;
            const outcome = await sendAndLog(sb, {
              to: c.phone,
              body,
              customer_id: c.id,
              type: 'review_request',
            });
            if (outcome === 'sent') results.review_request.sent++;
            else if (outcome === 'failed') results.review_request.failed++;
            else results.review_request.skipped++; // 'skipped' (no twilio) or 'no_phone'
          }
        }
      }
    }

    // ---- Appointment reminders for tomorrow's scheduled stops ----
    if (results.reminders.enabled) {
      const reminderDate = results.reminders.date;
      const { data: appts, error: apErr } = await sb
        .from('appointments')
        .select('id, customer_id, scheduled_at, status')
        .eq('scheduled_at', reminderDate)
        .eq('status', 'scheduled');
      if (apErr) throw apErr;

      const appointments = (appts ?? []) as Pick<
        Appointment,
        'id' | 'customer_id' | 'scheduled_at' | 'status'
      >[];

      if (appointments.length > 0) {
        const apptIds = appointments.map((a) => a.id);
        // Already-reminded appointments (idempotency by appointment_id).
        const { data: reminded, error: rErr } = await sb
          .from('notifications')
          .select('appointment_id')
          .eq('type', 'reminder')
          .in('appointment_id', apptIds);
        if (rErr) throw rErr;
        const remindedSet = new Set(
          ((reminded ?? []) as { appointment_id: string | null }[])
            .map((r) => r.appointment_id)
            .filter((x): x is string => Boolean(x))
        );

        const due = appointments.filter((a) => !remindedSet.has(a.id));
        if (due.length > 0) {
          const custIds = Array.from(new Set(due.map((a) => a.customer_id)));
          const { data: custs, error: custErr } = await sb
            .from('customers')
            .select('id, first_name, phone, active')
            .in('id', custIds);
          if (custErr) throw custErr;
          const custMap = new Map(
            ((custs ?? []) as Pick<
              Customer,
              'id' | 'first_name' | 'phone' | 'active'
            >[]).map((c) => [c.id, c])
          );

          for (const a of due) {
            const c = custMap.get(a.customer_id);
            if (!c || c.active === false) {
              results.reminders.skipped++;
              continue;
            }
            const name = c.first_name ? ` ${c.first_name}` : '';
            const body = `Hi${name}, this is a reminder that Scoop N Go is scheduled to visit tomorrow. Please make sure your gate is unlocked and pets are secured. Reply to this text with any questions!`;
            const outcome = await sendAndLog(sb, {
              to: c.phone,
              body,
              customer_id: c.id,
              type: 'reminder',
              appointment_id: a.id,
            });
            if (outcome === 'sent') results.reminders.sent++;
            else if (outcome === 'failed') results.reminders.failed++;
            else if (outcome === 'no_phone') results.reminders.no_phone++;
            else results.reminders.skipped++;
          }
        }
      }
    }

    return NextResponse.json({ ran: true, today, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Automations run failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Vercel Cron invokes via GET (with Authorization: Bearer <CRON_SECRET>);
// delegate to the same authorized logic.
export function GET(request: Request) {
  return POST(request);
}
