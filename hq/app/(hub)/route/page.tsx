// Workstream 2, Route view (server component).
// Fetches the selected day's stops with supabaseServer(), then hands them to the
// client RouteList for drag-to-reorder, mark-done/skip, and add-stop.

import { PageHeader } from '@/components/ui';
import { supabaseServer } from '@/lib/supabase';
import { todayISO, dayMonth } from '@/lib/format';
import type { Appointment, ApptStatus, Customer } from '@/lib/types';
import { RouteList, type RouteStop } from '@/components/route/RouteList';
import { DaySelector } from '@/components/route/DaySelector';

export const dynamic = 'force-dynamic';

const ROUTE_STATUSES: ApptStatus[] = ['scheduled', 'completed'];

async function loadStops(date: string): Promise<RouteStop[]> {
  try {
    const sb = supabaseServer();

    const { data: apptData, error } = await sb
      .from('appointments')
      .select('*')
      .eq('scheduled_at', date)
      .in('status', ROUTE_STATUSES);
    if (error) throw error;
    const appointments = (apptData ?? []) as Appointment[];

    const customerIds = Array.from(new Set(appointments.map((a) => a.customer_id)));
    const customerMap = new Map<string, Customer>();
    const dogCounts = new Map<string, number>();

    if (customerIds.length > 0) {
      const [{ data: custs }, { data: dogs }] = await Promise.all([
        sb.from('customers').select('*').in('id', customerIds),
        sb.from('dogs').select('customer_id').in('customer_id', customerIds),
      ]);
      for (const c of (custs ?? []) as Customer[]) customerMap.set(c.id, c);
      for (const d of (dogs ?? []) as { customer_id: string }[]) {
        dogCounts.set(d.customer_id, (dogCounts.get(d.customer_id) ?? 0) + 1);
      }
    }

    // Order by the appointment's saved position, falling back to the client's
    // STANDING route_order, then created_at. So a freshly generated route (no
    // per-day position yet) still comes up in your saved order.
    const orderOf = (a: Appointment) =>
      a.route_position ?? customerMap.get(a.customer_id)?.route_order ?? Number.POSITIVE_INFINITY;
    appointments.sort((a, b) => {
      const oa = orderOf(a);
      const ob = orderOf(b);
      if (oa !== ob) return oa - ob;
      return (a.created_at ?? '') < (b.created_at ?? '') ? -1 : 1;
    });

    return appointments.map((a) => {
      const c = customerMap.get(a.customer_id);
      return {
        id: a.id,
        customer_id: a.customer_id,
        scheduled_at: a.scheduled_at,
        status: a.status,
        route_position: a.route_position ?? null,
        service_type: a.service_type ?? null,
        notes: a.notes ?? null,
        customer: c
          ? {
              id: c.id,
              first_name: c.first_name,
              last_name: c.last_name,
              address: c.address,
              city: c.city,
              zip: c.zip,
              phone: c.phone,
              gate_code: c.gate_code,
            }
          : null,
        dog_count: dogCounts.get(a.customer_id) ?? 0,
        flags: c?.flags ?? [],
      };
    });
  } catch {
    return [];
  }
}

async function loadActiveCustomers(): Promise<{ id: string; name: string }[]> {
  try {
    const sb = supabaseServer();
    const { data } = await sb
      .from('customers')
      .select('id, first_name, last_name')
      .eq('active', true)
      .order('first_name', { ascending: true });
    return ((data ?? []) as Customer[]).map((c) => ({
      id: c.id,
      name: `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Unnamed',
    }));
  } catch {
    return [];
  }
}

export default async function RoutePage({
  searchParams,
}: {
  searchParams: { date?: string };
}) {
  const today = todayISO();
  const dateParam = searchParams.date;
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : today;

  const [stops, activeCustomers] = await Promise.all([loadStops(date), loadActiveCustomers()]);

  return (
    <div>
      <PageHeader
        title="Route"
        subtitle={`Stops for ${dayMonth(date)}${date === today ? ' (today)' : ''}`}
      />

      <div className="mb-5">
        <DaySelector today={today} selected={date} />
      </div>

      <RouteList key={date} date={date} initialStops={stops} activeCustomers={activeCustomers} />
    </div>
  );
}
