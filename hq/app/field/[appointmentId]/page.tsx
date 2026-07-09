// Workstream 5, Field tool: complete-a-visit form (mobile-first server component).
// Loads the appointment + customer (gate code / yard notes / dogs) for context,
// then renders the client VisitForm which POSTs to /api/visits.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader, EmptyState } from '@/components/ui';
import { supabaseServer } from '@/lib/supabase';
import { fullName, phone } from '@/lib/format';
import type { Appointment, Customer, Dog } from '@/lib/types';
import { VisitForm } from '@/components/field/VisitForm';

export const dynamic = 'force-dynamic';

interface LoadedVisit {
  appointment: Appointment;
  customer: Customer | null;
  dogs: Dog[];
}

async function loadVisit(appointmentId: string): Promise<LoadedVisit | null> {
  try {
    const sb = supabaseServer();
    const { data: appt, error } = await sb
      .from('appointments')
      .select('*')
      .eq('id', appointmentId)
      .maybeSingle();
    if (error) throw error;
    if (!appt) return null;

    const appointment = appt as Appointment;

    const [{ data: cust }, { data: dogs }] = await Promise.all([
      sb.from('customers').select('*').eq('id', appointment.customer_id).maybeSingle(),
      sb.from('dogs').select('*').eq('customer_id', appointment.customer_id),
    ]);

    return {
      appointment,
      customer: (cust as Customer) ?? null,
      dogs: (dogs ?? []) as Dog[],
    };
  } catch {
    return null;
  }
}

function addressLine(c: Customer | null): string {
  if (!c) return 'No address on file';
  const parts = [c.address, c.city, c.zip].filter(Boolean);
  return parts.length ? parts.join(', ') : 'No address on file';
}

export default async function VisitPage({
  params,
}: {
  params: { appointmentId: string };
}) {
  const data = await loadVisit(params.appointmentId);

  if (!data) {
    // Distinguish: a placeholder DB returns null too, so show a friendly state.
    return (
      <div className="max-w-md mx-auto px-4 py-5">
        <Link href="/field" className="text-sm font-heading font-bold text-brand-dark">
          ‹ Back to stops
        </Link>
        <div className="mt-4">
          <EmptyState
            title="Stop not found"
            hint="This visit could not be loaded. It may have been removed or the link is stale."
          />
        </div>
      </div>
    );
  }

  const { appointment, customer, dogs } = data;
  if (!customer) notFound();

  const name = fullName(customer) || 'Unknown customer';

  return (
    <div className="max-w-md mx-auto px-4 py-5">
      <Link href="/field" className="text-sm font-heading font-bold text-brand-dark">
        ‹ Back to stops
      </Link>

      <div className="mt-3">
        <PageHeader title={name} subtitle={addressLine(customer)} />
      </div>

      {/* Stop context, gate code, dogs, yard notes, phone */}
      <div className="bg-white rounded-card border border-line p-4 mb-4 flex flex-col gap-2.5 text-sm">
        {customer.gate_code && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted font-heading font-bold">Gate code</span>
            <span className="font-heading font-black text-ink text-base tracking-wide">
              {customer.gate_code}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted font-heading font-bold">Dogs</span>
          <span className="text-ink text-right">
            {dogs.length
              ? dogs.map((d) => d.name).join(', ')
              : 'None on file'}
          </span>
        </div>
        {customer.phone && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted font-heading font-bold">Phone</span>
            <a href={`tel:${customer.phone}`} className="text-brand-dark font-semibold">
              {phone(customer.phone)}
            </a>
          </div>
        )}
        {customer.yard_notes && (
          <div className="pt-1">
            <span className="block text-muted font-heading font-bold mb-1">Yard notes</span>
            <p className="text-ink">{customer.yard_notes}</p>
          </div>
        )}
      </div>

      <VisitForm
        appointmentId={appointment.id}
        customerId={customer.id}
        customerName={name}
        alreadyCompleted={appointment.status === 'completed'}
        autoCharge={Boolean(customer.auto_charge)}
      />
    </div>
  );
}
