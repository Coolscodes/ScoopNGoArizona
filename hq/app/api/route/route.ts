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

      return NextResponse.json({ ok: true, updated });
    }

    if (action === 'status') {
      const id = payload.id;
      const status = payload.status;
      const allowed: ApptStatus[] = ['completed', 'scheduled'];
      if (typeof id !== 'string' || !allowed.includes(status as ApptStatus)) {
        return NextResponse.json(
          { error: "status requires id and status in ['completed','scheduled']" },
          { status: 400 }
        );
      }

      const { error } = await sb
        .from('appointments')
        .update({ status })
        .eq('id', id);
      if (error) throw error;

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
