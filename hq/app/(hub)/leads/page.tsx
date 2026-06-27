import { PageHeader } from '@/components/ui';
import { LeadsInbox } from '@/components/leads/LeadsInbox';
import { supabaseServer } from '@/lib/supabase';
import type { Lead } from '@/lib/types';

export const dynamic = 'force-dynamic';

async function getLeads(): Promise<Lead[]> {
  try {
    const { data } = await supabaseServer()
      .from('leads')
      .select('*')
      .order('created_at', { ascending: false });
    return (data ?? []) as Lead[];
  } catch {
    return [];
  }
}

export default async function LeadsPage() {
  const leads = await getLeads();
  const newCount = leads.filter((l) => l.status === 'new').length;
  return (
    <div>
      <PageHeader
        title="Requests"
        subtitle={`${newCount} new · ${leads.length} total`}
      />
      <LeadsInbox leads={leads} />
    </div>
  );
}
