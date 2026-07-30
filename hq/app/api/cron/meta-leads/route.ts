// Meta instant-form lead poller.
//
// WHY THIS EXISTS
// ===============
// Meta has no way to email or text you a new lead. Verified July 2026: Leads
// Center settings only has permissions and funnel stages, Business Suite
// Automations can only be triggered by an inbound message, and Page notification
// settings are in-app only with no email channel at all. Leads just sit in Leads
// Center until someone opens it. The first real lead sat there for hours.
//
// So we pull instead. This endpoint asks Meta for every lead on every instant
// form attached to the Page, inserts the ones we have not seen into `leads`, and
// emails the details straight to Jett. Text delivery is the same email sent to a
// carrier SMS gateway address, which costs nothing and needs no Twilio.
//
//   GET /api/cron/meta-leads   (Authorization: Bearer <CRON_SECRET>, or x-cron-secret)
//     -> 200 { ok: true, checked, inserted, alerted, skipped? }
//     -> 200 { ok: false, status: 'skipped', reason }  when META_PAGE_ACCESS_TOKEN is unset
//     -> 401 when the cron secret is missing or wrong
//
// SCHEDULING
// ==========
// The Vercel plan here is Hobby, which allows a single cron job running once a
// day (see the note in /api/cron/daily). Once a day is useless for a 15 minute
// response promise, so point a free external pinger at this route every 5
// minutes instead, sending the header `x-cron-secret: <CRON_SECRET>`. Upgrading
// Vercel to Pro would let this move into vercel.json.
//
// ENV
// ===
//   META_PAGE_ACCESS_TOKEN   required, long-lived Page token with leads_retrieval
//   LEAD_ALERT_EMAIL         optional, defaults to jettbrown44@gmail.com
//   LEAD_ALERT_SMS_EMAIL     optional, carrier gateway address for text delivery
//                            (Verizon 6026220238@vtext.com, AT&T @txt.att.net,
//                             T-Mobile @tmomail.net)
//   RESEND_API_KEY           already configured, domain scoopngoarizona.com verified
//
// DEDUPE
// ======
// The `leads` table has no column for a Meta lead id, and adding one would mean a
// migration. Instead each inserted row carries the marker `meta:<lead_id>` in
// `notes`, and we filter against that before inserting. Cheap, and no schema risk.
//
// THE ALERT ITSELF
// ================
// Lives in lib/lead-alert.ts, because a route file cannot export anything but its
// handlers and the email needs to be checkable without waiting for a real lead.
// It carries a tap to text button that opens Messages with the reply prewritten
// (lib/lead-reply.ts), which is how a lead gets a text from Jett's own number.

import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { phoneLooksFake } from '@/lib/lead-reply';
import { alertHtml, alertSms, alertSubject, alertText, type LeadAlert } from '@/lib/lead-alert';

export const dynamic = 'force-dynamic';

const GRAPH = 'https://graph.facebook.com/v21.0';
const PAGE_ID = '1091988564001943';
const DEFAULT_ALERT_EMAIL = 'jettbrown44@gmail.com';

// Only look this far back, so a fresh deploy does not replay months of old leads
// and blow up the inbox. Meta returns newest first.
const LOOKBACK_DAYS = 7;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed
  const auth = request.headers.get('authorization');
  const bearer = auth?.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : null;
  return bearer === secret || request.headers.get('x-cron-secret') === secret;
}

interface MetaFieldDatum {
  name?: string;
  values?: string[];
}

interface MetaLead {
  id: string;
  created_time: string;
  field_data?: MetaFieldDatum[];
}

// Meta field names come from the question text, so they drift every time a form
// is rebuilt (v3, v4, v5 all differ). Match on substrings rather than exact keys.
function pick(fields: Map<string, string>, ...needles: string[]): string {
  for (const needle of needles) {
    for (const [key, value] of fields) {
      if (key.includes(needle) && value) return value;
    }
  }
  return '';
}

function toFieldMap(lead: MetaLead): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of lead.field_data ?? []) {
    const name = (f.name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '_');
    const value = (f.values ?? []).join(', ').trim();
    if (name) map.set(name, value);
  }
  return map;
}

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', last: '' };
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

interface ParsedLead extends LeadAlert {
  metaId: string;
}

function parseLead(lead: MetaLead): ParsedLead {
  const f = toFieldMap(lead);
  const { first, last } = splitName(pick(f, 'full_name', 'name'));
  const phone = pick(f, 'phone');
  return {
    metaId: lead.id,
    createdAt: lead.created_time,
    first,
    last,
    email: pick(f, 'email'),
    phone,
    zip: pick(f, 'zip', 'post_code'),
    city: pick(f, 'city'),
    dogs: pick(f, 'dogs'),
    frequency: pick(f, 'often', 'frequency', 'service'),
    suspectPhone: phoneLooksFake(phone),
  };
}

async function fetchFormIds(token: string): Promise<string[]> {
  const url = `${GRAPH}/${PAGE_ID}/leadgen_forms?fields=id&limit=100&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, { cache: 'no-store' });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.error?.message || `leadgen_forms failed (${res.status})`);
  }
  return (body?.data ?? []).map((f: { id: string }) => f.id);
}

async function fetchLeads(formId: string, token: string, sinceUnix: number): Promise<MetaLead[]> {
  const filtering = encodeURIComponent(
    JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: sinceUnix }])
  );
  const url =
    `${GRAPH}/${formId}/leads?fields=id,created_time,field_data&limit=100` +
    `&filtering=${filtering}&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, { cache: 'no-store' });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    // One bad form should not stop the others.
    console.error(`meta-leads: form ${formId} failed`, body?.error?.message);
    return [];
  }
  return (body?.data ?? []) as MetaLead[];
}

async function post(key: string, payload: Record<string, unknown>): Promise<boolean> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Scoop N Go Leads <leads@scoopngoarizona.com>', ...payload }),
  });
  return res.ok;
}

async function sendAlert(lead: ParsedLead): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;

  try {
    const emailed = await post(key, {
      to: [process.env.LEAD_ALERT_EMAIL || DEFAULT_ALERT_EMAIL],
      subject: alertSubject(lead),
      text: alertText(lead),
      html: alertHtml(lead),
      reply_to: lead.email || undefined,
    });

    // Sent separately so a gateway bounce never costs us the real email. Subject
    // is omitted from the body budget by keeping it to the bare essentials.
    const sms = process.env.LEAD_ALERT_SMS_EMAIL;
    if (sms) {
      await post(key, { to: [sms], subject: 'New lead', text: alertSms(lead) });
    }

    return emailed;
  } catch (err) {
    console.error('meta-leads: alert send failed', err);
    return false;
  }
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (!token) {
    // Same convention as /api/sms/send: an unconfigured integration is a skip,
    // never a crash, so the scheduler does not start alarming.
    return NextResponse.json({ ok: false, status: 'skipped', reason: 'META_PAGE_ACCESS_TOKEN not set' });
  }

  const sinceUnix = Math.floor(Date.now() / 1000) - LOOKBACK_DAYS * 86400;

  try {
    const formIds = await fetchFormIds(token);
    const batches = await Promise.all(formIds.map((id) => fetchLeads(id, token, sinceUnix)));
    const metaLeads = batches.flat();

    const sb = supabaseServer();
    let inserted = 0;
    let alerted = 0;

    for (const raw of metaLeads) {
      const lead = parseLead(raw);
      const marker = `meta:${lead.metaId}`;

      const { data: existing } = await sb.from('leads').select('id').ilike('notes', `%${marker}%`).limit(1);
      if (existing && existing.length > 0) continue;

      const notes = [
        `Source: Meta instant form`,
        lead.city ? `City answer: ${lead.city}` : '',
        lead.suspectPhone ? `Phone looks invalid (${lead.phone})` : '',
        marker,
      ]
        .filter(Boolean)
        .join(' | ');

      const { error } = await sb.from('leads').insert({
        first_name: lead.first,
        last_name: lead.last,
        phone: lead.phone,
        email: lead.email,
        zip: lead.zip,
        dogs: lead.dogs,
        service_type: lead.frequency,
        notes,
        status: 'new',
      });

      if (error) {
        console.error('meta-leads: insert failed', error.message);
        continue;
      }
      inserted += 1;
      if (await sendAlert(lead)) alerted += 1;
    }

    return NextResponse.json({
      ok: true,
      forms: formIds.length,
      checked: metaLeads.length,
      inserted,
      alerted,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Meta lead poll failed';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
