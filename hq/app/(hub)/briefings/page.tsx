// Briefings module, two AI-written briefings grounded in live business data:
// a punchy morning ops brief and a reflective weekly business review.

import { PageHeader } from '@/components/ui';
import { BriefingCard } from '@/components/briefings/BriefingCard';

export const dynamic = 'force-dynamic';

export default function BriefingsPage() {
  return (
    <div>
      <PageHeader
        title="Briefings"
        subtitle="AI-written summaries of your business, ready to read or hear aloud."
      />

      <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
        <BriefingCard
          title="Morning ops brief"
          description="Today's route, money watch, stale leads, and one top priority, ready before you head out."
          actionLabel="Generate brief"
          endpoint="/api/ops-brief"
        />
        <BriefingCard
          title="Weekly business review"
          description="Wins, revenue vs last week, operational issues, and next week's focus."
          actionLabel="Run weekly review"
          endpoint="/api/ops-review"
        />
      </div>
    </div>
  );
}
