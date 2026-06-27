import { PageHeader } from '@/components/ui';
import { ClientsTable } from '@/components/clients/ClientsTable';
import { supabaseServer } from '@/lib/supabase';
import type { Customer } from '@/lib/types';

export const dynamic = 'force-dynamic';

async function getClients(): Promise<{ clients: Customer[]; dogCounts: Record<string, number> }> {
  try {
    const sb = supabaseServer();
    const [{ data: clients }, { data: dogs }] = await Promise.all([
      sb.from('customers').select('*').order('first_name', { ascending: true }),
      sb.from('dogs').select('customer_id'),
    ]);
    const dogCounts: Record<string, number> = {};
    for (const d of (dogs ?? []) as { customer_id: string }[]) {
      dogCounts[d.customer_id] = (dogCounts[d.customer_id] ?? 0) + 1;
    }
    return { clients: (clients ?? []) as Customer[], dogCounts };
  } catch {
    return { clients: [], dogCounts: {} };
  }
}

export default async function ClientsPage() {
  const { clients, dogCounts } = await getClients();
  const activeCount = clients.filter((c) => c.active).length;
  return (
    <div>
      <PageHeader title="Clients" subtitle={`${activeCount} active · ${clients.length} total`} />
      <ClientsTable clients={clients} dogCounts={dogCounts} />
    </div>
  );
}
