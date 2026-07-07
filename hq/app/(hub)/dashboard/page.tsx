import { PageHeader, StatCard } from '@/components/ui';
import { dayMonth, money } from '@/lib/format';
import { getDashboardData } from '@/components/dashboard/data';
import { NeedsAttention } from '@/components/dashboard/NeedsAttention';
import { TodaysRoute } from '@/components/dashboard/TodaysRoute';

// Always read fresh, this is the live "Today" overview.
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const { metrics, needsAttention, route } = await getDashboardData();

  return (
    <div>
      <PageHeader title="Dashboard" subtitle={dayMonth(new Date())} />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-6">
        <StatCard label="Today's stops" value={metrics.todaysStops} />
        <StatCard
          label="Collected this week"
          value={money(metrics.collectedThisWeek)}
          tone="success"
        />
        <StatCard label="Unpaid" value={money(metrics.unpaid)} tone="warn" />
        <StatCard label="New requests" value={metrics.newRequests} tone="info" />
      </div>

      <NeedsAttention items={needsAttention} />

      <h2 className="font-heading text-[0.8rem] font-bold text-muted uppercase tracking-wider mb-2">
        Today's route
      </h2>
      <TodaysRoute stops={route} />
    </div>
  );
}
