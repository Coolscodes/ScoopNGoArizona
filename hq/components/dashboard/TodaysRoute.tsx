'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Table, Th, Td, StatusPill, Avatar, EmptyState, useToast } from '@/components/ui';
import { fullName, initials } from '@/lib/format';
import type { RouteStop } from './data';

// Charge outcome returned by PATCH /api/route when a stop is marked done
// (charge-on-completion for opted-in clients).
interface ChargeOutcome {
  attempted: boolean;
  reason?: string;
  result?:
    | { name: string; status: 'charged'; amount: number }
    | { name: string; status: 'skipped' | 'failed'; reason: string };
}

// Today's stops, ordered by route_position. Mark a stop done in place.
export function TodaysRoute({ stops }: { stops: RouteStop[] }) {
  const router = useRouter();
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function setStatus(id: string, status: 'completed' | 'scheduled') {
    setBusyId(id);
    try {
      const res = await fetch('/api/route', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status', id, status }),
      });
      if (!res.ok) throw new Error();
      const data = (await res.json().catch(() => ({}))) as { charge?: ChargeOutcome | null };
      const r = data.charge?.attempted ? data.charge.result : undefined;
      if (status === 'completed' && r?.status === 'charged') {
        toast(`Stop marked done, charged $${r.amount.toFixed(2)}`);
      } else if (status === 'completed' && r?.status === 'failed') {
        toast(`Stop done, but card charge failed: ${r.reason}`, 'error');
      } else {
        toast(status === 'completed' ? 'Stop marked done' : 'Stop reopened');
      }
      router.refresh();
    } catch {
      toast('Could not update the stop', 'error');
      setBusyId(null);
    }
  }

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
          <Th></Th>
        </tr>
      </thead>
      <tbody>
        {stops.map((stop, idx) => {
          const c = stop.customer;
          const address = [c?.address, c?.city].filter(Boolean).join(', ');
          const position = stop.appointment.route_position ?? idx + 1;
          const done = stop.appointment.status === 'completed';
          return (
            <tr key={stop.appointment.id} className={done ? 'opacity-70' : undefined}>
              <Td className="text-center font-heading font-black text-muted">{position}</Td>
              <Td>
                <div className="flex items-center gap-3">
                  <Avatar initials={initials(c)} />
                  <span className="font-heading font-bold text-ink">
                    {fullName(c) || 'Unknown client'}
                  </span>
                </div>
              </Td>
              <Td className="text-[0.85rem] text-muted max-w-[260px]">{address || '·'}</Td>
              <Td className="text-center font-semibold text-ink">{stop.dogCount || '·'}</Td>
              <Td>
                <StatusPill status={stop.appointment.status} />
              </Td>
              <Td className="text-right">
                <button
                  onClick={() => setStatus(stop.appointment.id, done ? 'scheduled' : 'completed')}
                  disabled={busyId === stop.appointment.id}
                  className={
                    'rounded-md px-3 py-1.5 text-[0.78rem] font-heading font-bold whitespace-nowrap disabled:opacity-50 ' +
                    (done
                      ? 'bg-white border border-line text-muted hover:text-ink'
                      : 'bg-brand text-white hover:bg-brand-dark')
                  }
                >
                  {busyId === stop.appointment.id ? '…' : done ? 'Undo' : 'Mark done'}
                </button>
              </Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
