// PUBLIC customer portal account page. Token-gated (no staff auth).
//
// Reads ?token= from the URL, validates it server-side, and loads ONLY that
// customer's data using the service-role client (which never reaches the
// browser). Anything that can't be matched to a token bounces to the login page.

import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase';
import { customerForToken } from '@/components/portal/data';
import type { PortalData } from '@/components/portal/data';
import type { Appointment, ServiceLog, Invoice } from '@/lib/types';
import { PortalShell } from '@/components/portal/PortalShell';
import { AccountView } from '@/components/portal/AccountView';

export const dynamic = 'force-dynamic';

// Loads the same scoped payload the GET /api/portal handler returns, but inline
// (no HTTP round-trip) so the service-role queries stay on the server. Every
// query is filtered by this one customer's id.
async function loadPortalData(token: string): Promise<PortalData | null> {
  const customer = await customerForToken(token);
  if (!customer) return null;

  const sb = supabaseServer();
  const nowISO = new Date().toISOString();

  const [{ data: upcoming }, { data: lastLog }, { data: unpaid }] = await Promise.all([
    sb
      .from('appointments')
      .select('scheduled_at, service_type, status')
      .eq('customer_id', customer.id)
      .eq('status', 'scheduled')
      .gte('scheduled_at', nowISO)
      .order('scheduled_at', { ascending: true })
      .limit(1),
    sb
      .from('service_logs')
      .select('completed_at, gate_photo_url')
      .eq('customer_id', customer.id)
      .order('completed_at', { ascending: false })
      .limit(1),
    sb
      .from('invoices')
      .select('id, amount, status, due_date, period_start, period_end')
      .eq('customer_id', customer.id)
      .in('status', ['sent', 'overdue'])
      .order('created_at', { ascending: false }),
  ]);

  const nextRow = (upcoming ?? [])[0] as Pick<Appointment, 'scheduled_at' | 'service_type'> | undefined;
  const lastRow = (lastLog ?? [])[0] as Pick<ServiceLog, 'completed_at' | 'gate_photo_url'> | undefined;
  const invoiceRows = (unpaid ?? []) as Invoice[];
  const balance = invoiceRows.reduce((sum, inv) => sum + (Number(inv.amount) || 0), 0);

  return {
    customer: {
      id: customer.id,
      first_name: customer.first_name,
      last_name: customer.last_name,
      email: customer.email,
      phone: customer.phone,
      address: customer.address,
      city: customer.city,
      zip: customer.zip,
      service_type: customer.service_type,
      preferred_day: customer.preferred_day,
      price_per_visit: customer.price_per_visit,
      frequency_weeks: customer.frequency_weeks,
      next_visit_date: customer.next_visit_date,
      active: customer.active,
      has_card_on_file: Boolean(customer.stripe_payment_method_id),
    },
    nextVisit: nextRow
      ? { scheduled_at: nextRow.scheduled_at, service_type: nextRow.service_type }
      : null,
    lastVisit: lastRow
      ? { completed_at: lastRow.completed_at, gate_photo_url: lastRow.gate_photo_url }
      : null,
    balance,
    invoices: invoiceRows.map((inv) => ({
      id: inv.id,
      amount: Number(inv.amount) || 0,
      status: inv.status,
      due_date: inv.due_date,
      period_start: inv.period_start,
      period_end: inv.period_end,
    })),
  };
}

export default async function MyAccountPage({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  const token = (searchParams.token || '').trim();
  if (!token) {
    redirect('/my-account/login');
  }

  const data = await loadPortalData(token);
  if (!data) {
    // Invalid/expired token, send them to log in again rather than leaking
    // anything about why it failed.
    redirect('/my-account/login');
  }

  return (
    <PortalShell>
      <AccountView data={data} token={token} />
    </PortalShell>
  );
}
