// Workstream 2 — Route view (server component).
// Fetches the selected day's stops with supabaseServer(), then hands them to the
// client RouteList for drag-to-reorder and mark-done (which mutate via /api/route).

import { PageHeader } from '@/components/ui';
import { supabaseServer } from '@/lib/supabase';
import { todayISO, dayMonth } from '@/lib/format';
import type { Appointment, ApptStatus, Customer } from '@/lib/types';
import { RouteList, type RouteStop } from '@/components/route/RouteList';
import { DaySelector } from '@/components/route/DaySelector';

export const dynamic = 'force-dynamic';

const ROUTE_STATUSES: ApptStatus[] = ['scheduled', 'completed'];

type CustomerLite = Pick<
  Customer,
  'id' | 'first_name' | 'last_name' | 'address' | 'city' | 'zip' | 'phone'
>;

function byPosition(a: Appointment, b: Appointment): number {
  const pa = a.route_position;
  const pb = b.route_position;
  if (pa == null && pb == null) return a.created_at < b.created_at ? -1 : 1;
  if (pa == null) return 1;
  if (pb == null) return -1;
  if (pa !== pb) return pa - pb;
  return a.created_at < b.created_at ? -1 : 1;
}

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

    return appointments.map((a) => ({
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
  } catch {
    // Env keys may be placeholders / DB may be empty — never crash the page.
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
  // Validate the date param shape; fall back to today otherwise.
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : today;

  const stops = await loadStops(date);

  return (
    <div>
      <PageHeader
        title="Route"
        subtitle={`Stops for ${dayMonth(date)}${date === today ? ' (today)' : ''}`}
      />

      <div className="mb-5">
        <DaySelector today={today} selected={date} />
      </div>

      <RouteList key={date} date={date} initialStops={stops} />
    </div>
  );
}
