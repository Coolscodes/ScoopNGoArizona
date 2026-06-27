// Workstream 8 — Automations (server component).
// Loads the seeded `automations` rows with supabaseServer(), then hands them to the
// client AutomationsList for per-row toggles (which persist via /api/automations).

import { PageHeader } from '@/components/ui';
import { supabaseServer } from '@/lib/supabase';
import type { Automation } from '@/lib/types';
import { AutomationsList } from '@/components/automations/AutomationsList';

export const dynamic = 'force-dynamic';

async function loadAutomations(): Promise<Automation[]> {
  try {
    const sb = supabaseServer();
    const { data, error } = await sb
      .from('automations')
      .select('*')
      .order('key', { ascending: true });
    if (error) throw error;
    return (data ?? []) as Automation[];
  } catch {
    // Env keys may be placeholders / table may be empty — never crash the page.
    return [];
  }
}

export default async function AutomationsPage() {
  const automations = await loadAutomations();

  return (
    <div>
      <PageHeader
        title="Automations"
        subtitle="Turn the messaging and billing automations on or off."
      />

      {automations.length === 0 ? (
        <p className="text-sm text-muted">
          No automations found. They are seeded by the database migration — check that
          the migration has run.
        </p>
      ) : (
        <AutomationsList initial={automations} />
      )}
    </div>
  );
}
