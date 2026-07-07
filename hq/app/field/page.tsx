// Workstream 5, Field tool: today's stops (mobile-first server component).
// Lists TODAY's scheduled appointments with customer name + address; each row
// links to the completion form. Auth-gated by middleware (not a public prefix).

import { PageHeader } from '@/components/ui';
import { supabaseServer } from '@/lib/supabase';
import { todayISO, dayMonth } from '@/lib/format';
import type { Appointment, Customer } from '@/lib/types';
import { FieldStopList, type FieldStop } from '@/components/field/FieldStopList';

export const dynamic = 'force-dynamic';

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

async function loadTodayStops(date: string): Promise<FieldStop[]> {
  try {
    const sb = supabaseServer();

    // Field tool shows the work still to do today: scheduled stops.
    const { data: apptData, error } = await sb
      .from('appointments')
      .select('*')
      .eq('scheduled_at', date)
      .eq('status', 'scheduled');

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
      status: a.status,
      route_position: a.route_position ?? null,
      service_type: a.service_type ?? null,
      customer: customerMap.get(a.customer_id) ?? null,
      dog_count: dogCounts.get(a.customer_id) ?? 0,
    }));
  } catch {
    // Placeholder env keys / empty DB, never crash the page.
    return [];
  }
}

export default async function FieldPage() {
  const today = todayISO();
  const stops = await loadTodayStops(today);

  return (
    <div className="max-w-md mx-auto px-4 py-5">
      <PageHeader
        title="Today's stops"
        subtitle={`${dayMonth(today)} · ${stops.length} to do`}
      />
      <FieldStopList stops={stops} />
    </div>
  );
}
