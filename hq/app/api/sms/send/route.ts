// Workstream 8, Send an SMS via Twilio and log it to `notifications`.
//
// JSON contract  (STABLE, other workstreams call this; do not break it)
// =====================================================================
// POST /api/sms/send
//   body: {
//     to: string,              // REQUIRED, destination phone (E.164 preferred, e.g. +14805551234)
//     body: string,            // REQUIRED, message text
//     customer_id?: string,    // optional, the customer this relates to (logged on notifications)
//     type?: string,           // optional, notification type tag, e.g. 'on_the_way' | 'completed'
//                              //            | 'reminder' | 'review_request'. Defaults to 'manual'.
//     appointment_id?: string  // optional, link to an appointment
//   }
//
//   -> 200 { ok: true,  status: 'sent',    sid, notification_id? }   on a successful send
//   -> 200 { ok: false, status: 'skipped', reason }  when Twilio is not configured
//            (we DO NOT crash, we still log the attempt as status='skipped')
//   -> 400 { ok: false, status: 'invalid', error }   on a malformed body
//   -> 500 { ok: false, status: 'failed',  error }   on a Twilio/database error
//            (a 'failed' notification row is logged when possible)
//
// Logging
// =======
// Every attempt is logged to `notifications` (channel:'sms') with a status of
// 'sent' | 'skipped' | 'failed'. NOTE: notifications.customer_id is NOT NULL in
// the database, so we only insert a row when a customer_id is provided. Ad-hoc
// sends without a customer_id still send/skip, they just aren't persisted (the
// response status still reflects the outcome).

import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { sendSms, isTwilioConfigured, TwilioNotConfiguredError } from '@/lib/twilio';

export const dynamic = 'force-dynamic';

interface SendBody {
  to?: unknown;
  body?: unknown;
  customer_id?: unknown;
  type?: unknown;
  appointment_id?: unknown;
}

type LogStatus = 'sent' | 'skipped' | 'failed';

// Best-effort insert into notifications. Skips silently if there's no customer_id
// (the column is NOT NULL) or if the insert errors, logging must never break a send.
async function logNotification(opts: {
  customer_id?: string;
  type: string;
  message: string;
  status: LogStatus;
  appointment_id?: string;
}): Promise<string | null> {
  if (!opts.customer_id) return null;
  try {
    const sb = supabaseServer();
    const { data, error } = await sb
      .from('notifications')
      .insert({
        customer_id: opts.customer_id,
        type: opts.type,
        channel: 'sms',
        message: opts.message,
        status: opts.status,
        appointment_id: opts.appointment_id ?? null,
        sent_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (error) return null;
    return (data?.id as string) ?? null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  let parsed: SendBody;
  try {
    parsed = (await request.json()) as SendBody;
  } catch {
    return NextResponse.json(
      { ok: false, status: 'invalid', error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  const to = typeof parsed.to === 'string' ? parsed.to.trim() : '';
  const body = typeof parsed.body === 'string' ? parsed.body.trim() : '';
  const customer_id =
    typeof parsed.customer_id === 'string' && parsed.customer_id
      ? parsed.customer_id
      : undefined;
  const appointment_id =
    typeof parsed.appointment_id === 'string' && parsed.appointment_id
      ? parsed.appointment_id
      : undefined;
  const type = typeof parsed.type === 'string' && parsed.type ? parsed.type : 'manual';

  if (!to || !body) {
    return NextResponse.json(
      { ok: false, status: 'invalid', error: "Both 'to' and 'body' are required." },
      { status: 400 }
    );
  }

  // Not configured -> don't crash. Log the attempt as 'skipped' and return 200.
  if (!isTwilioConfigured()) {
    const notification_id = await logNotification({
      customer_id,
      type,
      message: body,
      status: 'skipped',
      appointment_id,
    });
    return NextResponse.json({
      ok: false,
      status: 'skipped',
      reason: 'Twilio is not configured (missing TWILIO_* env vars).',
      notification_id,
    });
  }

  try {
    const result = await sendSms(to, body);
    const notification_id = await logNotification({
      customer_id,
      type,
      message: body,
      status: 'sent',
      appointment_id,
    });
    return NextResponse.json({
      ok: true,
      status: 'sent',
      sid: result.sid,
      twilio_status: result.status,
      notification_id,
    });
  } catch (err) {
    // Belt-and-suspenders: if config disappeared between the check and the call.
    if (err instanceof TwilioNotConfiguredError) {
      const notification_id = await logNotification({
        customer_id,
        type,
        message: body,
        status: 'skipped',
        appointment_id,
      });
      return NextResponse.json({
        ok: false,
        status: 'skipped',
        reason: err.message,
        notification_id,
      });
    }

    const error = err instanceof Error ? err.message : 'Failed to send SMS';
    const notification_id = await logNotification({
      customer_id,
      type,
      message: body,
      status: 'failed',
      appointment_id,
    });
    return NextResponse.json(
      { ok: false, status: 'failed', error, notification_id },
      { status: 500 }
    );
  }
}
