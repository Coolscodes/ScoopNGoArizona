import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader, Card, Avatar, StatusPill, Badge } from '@/components/ui';
import { ClientForm } from '@/components/clients/ClientForm';
import { ClientQuickActions } from '@/components/clients/ClientQuickActions';
import { DogsEditor } from '@/components/clients/DogsEditor';
import { FlagsEditor } from '@/components/clients/FlagsEditor';
import { supabaseServer } from '@/lib/supabase';
import { money, phone as fmtPhone, fullName, initials, shortDate } from '@/lib/format';
import type { Customer, Dog, Appointment, Invoice, ServiceLog } from '@/lib/types';

export const dynamic = 'force-dynamic';

async function getClient(id: string) {
  const sb = supabaseServer();
  const [{ data: client }, { data: dogs }, { data: appts }, { data: invoices }, { data: logs }] =
    await Promise.all([
      sb.from('customers').select('*').eq('id', id).maybeSingle(),
      sb.from('dogs').select('*').eq('customer_id', id).order('name'),
      sb.from('appointments').select('*').eq('customer_id', id).order('scheduled_at', { ascending: false }).limit(6),
      sb.from('invoices').select('*').eq('customer_id', id).order('created_at', { ascending: false }).limit(6),
      sb.from('service_logs').select('*').eq('customer_id', id).order('completed_at', { ascending: false }).limit(6),
    ]);
  return {
    client: (client as Customer) ?? null,
    dogs: (dogs ?? []) as Dog[],
    appts: (appts ?? []) as Appointment[],
    invoices: (invoices ?? []) as Invoice[],
    logs: (logs ?? []) as ServiceLog[],
  };
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div className="text-[0.72rem] uppercase tracking-wide text-muted">{label}</div>
      <div className="text-sm text-ink">{value || '—'}</div>
    </div>
  );
}

export default async function ClientDetailPage({ params }: { params: { id: string } }) {
  const { client, dogs, appts, invoices, logs } = await getClient(params.id);
  if (!client) notFound();

  const balance = invoices
    .filter((i) => i.status === 'sent' || i.status === 'overdue')
    .reduce((s, i) => s + (Number(i.amount) || 0), 0);

  const photoByAppt = new Set(logs.filter((l) => l.gate_photo_url).map((l) => l.appointment_id));

  return (
    <div>
      <Link href="/clients" className="text-sm text-muted hover:text-brand">← All clients</Link>
      <div className="mt-2">
        <PageHeader
          title={fullName(client) || 'Client'}
          subtitle={[client.service_type, client.preferred_day, client.price_per_visit != null ? money(client.price_per_visit) + '/visit' : null]
            .filter(Boolean)
            .join(' · ')}
          actions={
            <div className="flex items-center gap-2 flex-wrap">
              <ClientQuickActions
                customerId={client.id}
                customerName={fullName(client)}
                email={client.email}
                stripeCustomerId={client.stripe_customer_id}
                hasCard={Boolean(client.stripe_customer_id)}
              />
              <ClientForm client={client} />
            </div>
          }
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-center gap-3 mb-4">
            <Avatar initials={initials(client)} />
            <div className="flex-1">
              <div className="font-heading font-bold">{fullName(client)}</div>
              <div className="text-sm text-muted">{fmtPhone(client.phone)}</div>
            </div>
            <StatusPill status={client.active ? 'active' : 'inactive'} />
          </div>
          <div className="grid grid-cols-2 gap-3 border-t border-line pt-4">
            <Row label="Email" value={client.email} />
            <Row label="Address" value={[client.address, client.city, client.zip].filter(Boolean).join(', ')} />
            <Row label="Gate code" value={client.gate_code} />
            <Row label="Frequency" value={client.frequency_weeks ? `Every ${client.frequency_weeks} wk` : undefined} />
            <Row label="Card on file" value={client.stripe_customer_id ? 'Yes' : 'No'} />
            <Row label="Balance" value={money(balance)} />
          </div>
          {client.yard_notes && (
            <div className="border-t border-line pt-4 mt-4">
              <div className="text-[0.72rem] uppercase tracking-wide text-muted mb-1">Yard notes / access</div>
              <p className="text-sm text-ink">{client.yard_notes}</p>
            </div>
          )}
          <div className="border-t border-line pt-4 mt-4">
            <div className="text-[0.72rem] uppercase tracking-wide text-muted mb-2">Flags</div>
            <FlagsEditor clientId={client.id} flags={client.flags ?? []} />
          </div>
        </Card>

        <Card className="p-5">
          <div className="font-heading font-bold mb-3">Dogs</div>
          <DogsEditor clientId={client.id} dogs={dogs} />
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 mt-4">
        <Card className="p-5">
          <div className="font-heading font-bold mb-3">Recent visits</div>
          {appts.length === 0 ? (
            <p className="text-sm text-muted">No visits yet.</p>
          ) : (
            <div className="divide-y divide-line">
              {appts.map((a) => (
                <div key={a.id} className="flex items-center justify-between py-2.5 text-sm">
                  <span>{shortDate(a.scheduled_at)}</span>
                  <span className="flex items-center gap-2">
                    {photoByAppt.has(a.id) && <span className="text-xs text-brand">photo</span>}
                    <StatusPill status={a.status} />
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <div className="font-heading font-bold mb-3">Recent invoices</div>
          {invoices.length === 0 ? (
            <p className="text-sm text-muted">No invoices yet.</p>
          ) : (
            <div className="divide-y divide-line">
              {invoices.map((i) => (
                <div key={i.id} className="flex items-center justify-between py-2.5 text-sm">
                  <span>{shortDate(i.created_at)}</span>
                  <span className="flex items-center gap-2">
                    <span className="font-heading font-bold">{money(i.amount)}</span>
                    <StatusPill status={i.status} />
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
