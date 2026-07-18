// Daily cron orchestrator.
//
// Vercel Cron hits this once a day (GET, with Authorization: Bearer <CRON_SECRET>).
// It runs the three safe, non-financial automations in order, by calling the
// existing endpoints against this same deployment:
//   1. /api/jobs/generate, materialize each active client's next recurring visit
//   2. /api/auto-invoice, create invoices for today's service-day clients (no charge)
//   3. /api/automations/run, reminders + review requests (skips if Twilio is unconfigured)
//
// Charging real cards (/api/charge) is intentionally NOT run here, that stays a
// manual, human-in-the-loop action. Using one orchestrator keeps us to a single
// Vercel cron job (within Hobby-plan limits) and guarantees ordering.

import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed
  const auth = request.headers.get('authorization');
  const bearer = auth?.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : null;
  return bearer === secret || request.headers.get('x-cron-secret') === secret;
}

const STEPS = ['/api/jobs/generate', '/api/auto-invoice', '/api/automations/run'];

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const origin = new URL(request.url).origin;
  const secret = process.env.CRON_SECRET as string;
  const headers = {
    Authorization: `Bearer ${secret}`,
    'Content-Type': 'application/json',
  };

  const results: Record<string, unknown> = {};
  for (const path of STEPS) {
    try {
      const res = await fetch(origin + path, { method: 'POST', headers });
      results[path] = { status: res.status, body: await res.json().catch(() => null) };
    } catch (err) {
      results[path] = { error: err instanceof Error ? err.message : String(err) };
    }
  }

  // Heartbeat: record that the daily run happened, so the dashboard can warn
  // when the scheduler silently stops (it once sat dead for three weeks).
  // Stored as a hidden automations row; the Automations UI filters it out.
  try {
    const sb = supabaseServer();
    const now = new Date().toISOString();
    const { data: hb } = await sb
      .from('automations')
      .select('id')
      .eq('key', 'cron_heartbeat')
      .limit(1);
    if (hb && hb.length > 0) {
      await sb
        .from('automations')
        .update({ config: { last_run_at: now } })
        .eq('key', 'cron_heartbeat');
    } else {
      await sb.from('automations').insert({
        key: 'cron_heartbeat',
        label: 'Daily cron heartbeat (system)',
        enabled: true,
        config: { last_run_at: now },
      });
    }
  } catch {
    // The heartbeat must never fail the run itself.
  }

  return NextResponse.json({ ran: true, at: new Date().toISOString(), results });
}
