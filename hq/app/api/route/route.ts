// Workstream 2 — Route & scheduling API.
//
// JSON contract
// =============
// GET  /api/route?date=YYYY-MM-DD
//   -> 200 { date, stops: RouteStop[] }
//      RouteStop = {
//        id, customer_id, scheduled_at, status, route_position,
//        service_type, notes,
//        customer: { id, first_name, last_name, address, city, zip, phone } | null,
//        dog_count: number
//      }
//   Stops are appointments with status 'scheduled' | 'completed' for that date,
//   ordered by route_position (nulls last), then created_at.
//
// PATCH /api/route   (one body, two supported actions)
//   Reorder:   { action: 'reorder', date, order: string[] }  // ordered appointment ids
//                -> 200 { ok: true, updated: number }
//   Mark done: { action: 'status', id, status: 'completed' | 'scheduled' }
//                -> 200 { ok: true, id, status }
//   -> 400 on a malformed body, 500 on a database error.

import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { todayISO } from '@/lib/format';
import type { Appointment, ApptStatus, Customer } from '@/lib/types';

export const dynamic = 'force-dynamic';

type CustomerLite = Pick<
  Customer,
  'id' | 'first_name' | 'last_name' | 'address' | 'city' | 'zip' | 'phone'
>;

export interface RouteStop {
  id: string;
  customer_id: string;
  scheduled_at: string;
  status: ApptStatus;
  route_position: number | null;
  service_type: string | null;
  notes: string | null;
  customer: CustomerLite | null;
  dog_count: number;
}

const ROUTE_STATUSES: ApptStatus[] = ['scheduled', 'completed'];

// route_position ascending with nulls last, then by created_at for stable order.
function byPosition(a: Appointment, b: Appointment): number {
  const pa = a.route_position;
  const pb = b.route_position;
  if (pa == null && pb == null) return a.created_at < b.created_at ? -1 : 1;
  if (pa == null) return 1;
  if (pb == null) return -1;
  if (pa !== pb) return pa - pb;
  return a.created_at < b.created_at ? -1 : 1;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date') || todayISO();

  try {
    const sb = supabaseServer();

    const { data: appts, error } = await sb
      .from('appointments')
      .select('*')
      .eq('scheduled_at', date)
      .in('status', ROUTE_STATUSES);

    if (error) throw error;

    const appointments = (appts ?? []) as Appointment[];
    appointments.sort(byPosition);

    const customerIds = Array.from(new Set(appointments.map((a) => a.customer_id)));

    const customerMap = new Map<string, CustomerLite>();
    const dogCounts = new Map<string, number>();

    if (customerIds.length > 0) {
      const [{ data: custs }, { data: dogs }] = await Promise.all([
        sb
          .from('customers')
          .select('id, first_name, last_name, address, city, zip, phone')
          .in('id', customerIds),
        sb.from('dogs').select('customer_id').in('customer_id', customerIds),
      ]);

      for (const c of (custs ?? []) as CustomerLite[]) customerMap.set(c.id, c);
      for (const d of (dogs ?? []) as { customer_id: string }[]) {
        dogCounts.set(d.customer_id, (dogCounts.get(d.customer_id) ?? 0) + 1);
      }
    }

    const stops: RouteStop[] = appointments.map((a) => ({
      id: a.id,
      customer_id: a.customer_id,
      scheduled_at: a.scheduled_at,
      status: a.status,
      route_position: a.route_position ?? null,
      service_type: a.service_type ?? null,
      notes: a.notes ?? null,
      customer: customerMap.get(a.customer_id) ?? null,
      dog_count: dogCounts.get(a.customer_id) ?? 0,
    }));

    return NextResponse.json({ date, stops });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load route';
    return NextResponse.json({ error: message, date, stops: [] }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const payload = body as Record<string, unknown>;
  const action = payload.action;

  try {
    const sb = supabaseServer();

    if (action === 'reorder') {
      const order = payload.order;
      if (!Array.isArray(order) || order.some((id) => typeof id !== 'string')) {
        return NextResponse.json(
          { error: 'reorder requires order: string[]' },
          { status: 400 }
        );
      }

      // Write 1-based route_position for each id in the given order.
      let updated = 0;
      for (let i = 0; i < order.length; i++) {
        const { error } = await sb
          .from('appointments')
          .update({ route_position: i + 1 })
          .eq('id', order[i] as string);
        if (error) throw error;
        updated++;
      }

      // Also persist a STANDING order per client (customers.route_order) so every
      // future route for this day-of-week inherits it. Best-effort: if the column
      // doesn't exist yet (migration 002 not run), this no-ops without failing.
      try {
        const ids = order as string[];
        const { data: rows } = await sb
          .from('appointments')
          .select('id, customer_id')
          .in('id', ids);
        const custByAppt = new Map(
          ((rows ?? []) as { id: string; customer_id: string }[]).map((r) => [r.id, r.customer_id])
        );
        for (let i = 0; i < ids.length; i++) {
          const cid = custByAppt.get(ids[i]);
          if (cid) await sb.from('customers').update({ route_order: i + 1 }).eq('id', cid);
        }
      } catch {
        // route_order column not present yet — standing order will start working
        // after migration 002 is run. Per-day reorder above still saved.
      }

      return NextResponse.json({ ok: true, updated });
    }

    if (action === 'status') {
      const id = payload.id;
      const status = payload.status;
      const allowed: ApptStatus[] = ['completed', 'scheduled', 'skipped'];
      if (typeof id !== 'string' || !allowed.includes(status as ApptStatus)) {
        return NextResponse.json(
          { error: "status requires id and status in ['completed','scheduled','skipped']" },
          { status: 400 }
        );
      }

      const { error } = await sb
        .from('appointments')
        .update({ status })
        .eq('id', id);
      if (error) throw error;

      // Keep service_logs in sync so analytics / client history / the AI see
      // visits marked done from the route (not just field-tool completions).
      const ROUTE_DONE_NOTE = 'Marked done from route';
      try {
        if (status === 'completed') {
          const { data: existing } = await sb
            .from('service_logs')
            .select('id')
            .eq('appointment_id', id)
            .limit(1);
          if (!existing || existing.length === 0) {
            const { data: appt } = await sb
              .from('appointments')
              .select('customer_id')
              .eq('id', id)
              .single();
            if (appt) {
              await sb.from('service_logs').insert({
                customer_id: appt.customer_id,
                appointment_id: id,
                completed_at: new Date().toISOString(),
                issue_flagged: false,
                technician_notes: ROUTE_DONE_NOTE,
              });
            }
          }
        } else {
          // Undo / skip: remove only the auto-created route log — never a
          // field-tool log (which has photos/notes worth keeping).
          await sb
            .from('service_logs')
            .delete()
            .eq('appointment_id', id)
            .eq('technician_notes', ROUTE_DONE_NOTE);
        }
      } catch {
        // Log sync is best-effort; the status change itself already succeeded.
      }

      return NextResponse.json({ ok: true, id, status });
    }

    return NextResponse.json(
      { error: "Unknown action — use 'reorder' or 'status'" },
      { status: 400 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update route';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/route  { date: YYYY-MM-DD, customer_id }
//   Add a client to a specific day's route. Skips if they already have a stop
//   that day. New stop inherits the client's standing route_order if set.
export async function POST(request: Request) {
  let body: { date?: string; customer_id?: string };
  try {
    body = (await request.json()) as { date?: string; customer_id?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const date = body.date;
  const customerId = body.customer_id;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !customerId) {
    return NextResponse.json({ error: 'date (YYYY-MM-DD) and customer_id are required' }, { status: 400 });
  }

  try {
    const sb = supabaseServer();

    // Don't double-book the same client on the same day.
    const { data: existing } = await sb
      .from('appointments')
      .select('id')
      .eq('customer_id', customerId)
      .eq('scheduled_at', date)
      .neq('status', 'cancelled')
      .limit(1);
    if (existing && existing.length > 0) {
      return NextResponse.json({ ok: true, duplicate: true });
    }

    const { data: custData } = await sb.from('customers').select('*').eq('id', customerId).single();
    const c = custData as Customer | null;

    const { data: ins, error } = await sb
      .from('appointments')
      .insert({
        customer_id: customerId,
        scheduled_at: date,
        status: 'scheduled',
        service_type: c?.service_type ?? null,
        route_position: c?.route_order ?? null,
      })
      .select('id')
      .single();
    if (error) throw error;

    return NextResponse.json({ ok: true, id: (ins as { id: string } | null)?.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to add stop';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
