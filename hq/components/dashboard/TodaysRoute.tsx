import { Table, Th, Td, StatusPill, Avatar, EmptyState } from '@/components/ui';
import { fullName, initials } from '@/lib/format';
import type { RouteStop } from './data';

// Read-only summary of today's stops, ordered by route_position (nulls last).
// Reordering is owned by Workstream 2 — this view does not mutate anything.
export function TodaysRoute({ stops }: { stops: RouteStop[] }) {
  if (stops.length === 0) {
    return (
      <EmptyState
        title="No stops scheduled for today"
        hint="Appointments generated for today will appear here in route order."
      />
    );
  }

  return (
    <Table>
      <thead>
        <tr>
          <Th className="w-12 text-center">#</Th>
          <Th>Client</Th>
          <Th>Address</Th>
          <Th className="text-center">Dogs</Th>
          <Th>Status</Th>
        </tr>
      </thead>
      <tbody>
        {stops.map((stop, idx) => {
          const c = stop.customer;
          const address = [c?.address, c?.city].filter(Boolean).join(', ');
          const position = stop.appointment.route_position ?? idx + 1;
          return (
            <tr key={stop.appointment.id}>
              <Td className="text-center font-heading font-black text-muted">
                {position}
              </Td>
              <Td>
                <div className="flex items-center gap-3">
                  <Avatar initials={initials(c)} />
                  <span className="font-heading font-bold text-ink">
                    {fullName(c) || 'Unknown client'}
                  </span>
                </div>
              </Td>
              <Td className="text-[0.85rem] text-muted max-w-[260px]">
                {address || '—'}
              </Td>
              <Td className="text-center font-semibold text-ink">
                {stop.dogCount || '—'}
              </Td>
              <Td>
                <StatusPill status={stop.appointment.status} />
              </Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
