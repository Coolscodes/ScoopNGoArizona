// Daily cron orchestrator.
//
// Vercel Cron hits this once a day (GET, with Authorization: Bearer <CRON_SECRET>).
// It runs the three safe, non-financial automations in order:
//   1. /api/jobs/generate, materialize each active client's due recurring visits
//   2. /api/auto-invoice, create invoices for today's service-day clients (no charge)
//   3. /api/automations/run, reminders + review requests (skips if Twilio is unconfigured)
//
// Charging real cards (/api/charge) is intentionally NOT run here, that stays a
// manual, human-in-the-loop action. Using one orchestrator keeps us to a single
// Vercel cron job (within Hobby-plan limits) and guarantees ordering.
//
// The steps run in process. An earlier version fetched them over HTTP from this
// deployment's own origin, which put origin resolution, DNS, TLS and the
// middleware auth gate between the cron and its own handlers. Each of those is a
// way to fail, and nothing recorded the outcome (Vercel Cron discards the
// response body), so a failure was invisible: the heartbeat kept writing green
// while visit generation sat dead from 2026-07-17 to 2026-09-04. Calling the
// handlers directly removes the whole class of failure, and the step results are
// now persisted on the heartbeat row so the dashboard can see a bad run.

import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { POST as generateVisits } from '@/app/api/jobs/generate/route';
import { POST as autoInvoice } from '@/app/api/auto-invoice/route';
import { POST as runAutomations } from '@/app/api/automations/run/route';

export const dynamic = 'force-dynamic';

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed
  const auth = request.headers.get('authorization');
  const bearer = auth?.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : null;
  return bearer === secret || request.headers.get('x-cron-secret') === secret;
}

const STEPS: { name: string; run: (request: Request) => Promise<Response> }[] = [
  { name: '/api/jobs/generate', run: generateVisits },
  { name: '/api/auto-invoice', run: autoInvoice },
  { name: '/api/automations/run', run: runAutomations },
];

type StepResult = {
  status: number;
  ok: boolean;
  error?: string;
  summary?: Record<string, number>;
  body?: unknown;
};

// A step can answer 200 and still have done nothing useful (the generator reports
// per-customer failures in its body rather than failing the whole run), so pull the
// counts out and keep them on the heartbeat.
function summarize(body: unknown): Record<string, number> | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (Array.isArray(value)) out[key] = value.length;
    else if (typeof value === 'number') out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const secret = process.env.CRON_SECRET as string;

  // Each handler authorizes its own request, so hand it one carrying the secret.
  // The URL is only there to satisfy the Request constructor, nothing dials it.
  function stepRequest(name: string): Request {
    return new Request(`https://cron.internal${name}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
    });
  }

  const results: Record<string, StepResult> = {};

  for (const step of STEPS) {
    try {
      const res = await step.run(stepRequest(step.name));
      const body = await res.json().catch(() => null);
      const summary = summarize(body);
      results[step.name] = {
        status: res.status,
        ok: res.ok,
        body,
        ...(summary ? { summary } : {}),
        ...(res.ok ? {} : { error: (body as { error?: string } | null)?.error ?? 'Step failed' }),
      };
    } catch (err) {
      // A thrown step must not stop the ones after it.
      results[step.name] = {
        status: 0,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  const failed = Object.entries(results)
    .filter(([, r]) => !r.ok || (r.summary?.failed ?? 0) > 0)
    .map(([name, r]) =>
      r.ok
        ? `${name}: ${r.summary?.failed} record(s) failed`
        : `${name}: ${r.error ?? r.status}`
    );

  // Heartbeat: record that the daily run happened AND how each step went, so the
  // dashboard can warn both when the scheduler stops and when it runs but fails.
  // Stored as a hidden automations row; the Automations UI filters it out.
  try {
    const sb = supabaseServer();
    const config = {
      last_run_at: new Date().toISOString(),
      ok: failed.length === 0,
      failed_steps: failed,
      steps: Object.fromEntries(
        Object.entries(results).map(([name, r]) => [
          name,
          {
            status: r.status,
            ok: r.ok,
            ...(r.summary ? { summary: r.summary } : {}),
            ...(r.error ? { error: r.error } : {}),
          },
        ])
      ),
    };
    const { data: hb } = await sb
      .from('automations')
      .select('id')
      .eq('key', 'cron_heartbeat')
      .limit(1);
    if (hb && hb.length > 0) {
      await sb.from('automations').update({ config }).eq('key', 'cron_heartbeat');
    } else {
      await sb.from('automations').insert({
        key: 'cron_heartbeat',
        label: 'Daily cron heartbeat (system)',
        enabled: true,
        config,
      });
    }
  } catch {
    // The heartbeat must never fail the run itself.
  }

  return NextResponse.json({
    ran: true,
    at: new Date().toISOString(),
    ok: failed.length === 0,
    failed,
    results,
  });
}
