// Workstream 5, Mobile list of today's stops (client component).
// Big tap targets, single column. Each row links to the completion form.

import Link from 'next/link';
import { EmptyState, Avatar, StatusPill } from '@/components/ui';
import { fullName, initials } from '@/lib/format';

export interface FieldStop {
  id: string;
  customer_id: string;
  status: string;
  route_position: number | null;
  service_type: string | null;
  customer: {
    id: string;
    first_name: string;
    last_name: string;
    address?: string;
    city?: string;
    zip?: string;
    phone?: string;
  } | null;
  dog_count: number;
}

function addressLine(c: FieldStop['customer']): string {
  if (!c) return 'No address on file';
  const parts = [c.address, c.city, c.zip].filter(Boolean);
  return parts.length ? parts.join(', ') : 'No address on file';
}

export function FieldStopList({ stops }: { stops: FieldStop[] }) {
  if (stops.length === 0) {
    return (
      <EmptyState
        title="No stops today"
        hint="There are no scheduled visits for today. Check the Route screen to plan the day."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {stops.map((stop, index) => {
        const cust = stop.customer;
        return (
          <li key={stop.id}>
            <Link
              href={`/field/${stop.id}`}
              className="bg-white rounded-card border border-line flex items-center gap-4 p-4 active:bg-tan transition-colors min-h-[5rem]"
            >
              <div className="font-heading font-black text-brand-dark text-lg w-6 text-center shrink-0">
                {stop.route_position ?? index + 1}
              </div>

              <Avatar initials={initials(cust ?? undefined)} className="w-12 h-12 text-base" />

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-heading font-bold text-ink text-[1.05rem] truncate">
                    {cust ? fullName(cust) : 'Unknown customer'}
                  </span>
                  <StatusPill status={stop.status} />
                </div>
                <div className="text-sm text-muted truncate mt-0.5">{addressLine(cust)}</div>
                <div className="text-[0.8rem] text-muted mt-0.5 flex items-center gap-2 flex-wrap">
                  <span>
                    {stop.dog_count} dog{stop.dog_count === 1 ? '' : 's'}
                  </span>
                  {stop.service_type && (
                    <>
                      <span aria-hidden>·</span>
                      <span>{stop.service_type}</span>
                    </>
                  )}
                </div>
              </div>

              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                className="text-muted shrink-0"
                aria-hidden
              >
                <path d="M7 4l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
