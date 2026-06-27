// Workstream 7 — Customer portal: skip the next visit.
//
// PUBLIC surface, token-gated. The customer can skip ONLY their own next
// scheduled appointment. We resolve the token to the owning customer first,
// then update an appointment that is BOTH the next scheduled one AND belongs to
// that customer — so a token can never affect another customer's schedule.
//
//   POST /api/portal/skip  { token }  -> 200 { ok: true, skipped: <appointment_id> | null }

import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { customerForToken } from '@/components/portal/data';
import type { Appointment } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let body: { token?: unknown };
  try {
    body = (await request.json()) as { token?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 });
  }

  try {
    const customer = await customerForToken(token);
    if (!customer) {
      return NextResponse.json({ error: 'Invalid or expired link' }, { status: 404 });
    }

    const sb = supabaseServer();
    const nowISO = new Date().toISOString();

    // Find this customer's next scheduled appointment.
    const { data: next, error: findErr } = await sb
      .from('appointments')
      .select('id')
      .eq('customer_id', customer.id)
      .eq('status', 'scheduled')
      .gte('scheduled_at', nowISO)
      .order('scheduled_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (findErr) throw findErr;

    if (!next) {
      // Nothing upcoming to skip — not an error, just a no-op.
      return NextResponse.json({ ok: true, skipped: null });
    }

    const apptId = (next as Pick<Appointment, 'id'>).id;

    // Update is double-scoped (id + customer_id) as defense in depth so the token
    // holder can only ever flip an appointment they own.
    const { error: upErr } = await sb
      .from('appointments')
      .update({ status: 'skipped' })
      .eq('id', apptId)
      .eq('customer_id', customer.id);
    if (upErr) throw upErr;

    return NextResponse.json({ ok: true, skipped: apptId });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to skip visit';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
