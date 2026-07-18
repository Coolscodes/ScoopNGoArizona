import { PageHeader, StatCard } from '@/components/ui';
import { dayMonth, money, shortDate, todayISO } from '@/lib/format';
import { getDashboardData } from '@/components/dashboard/data';
import { NeedsAttention } from '@/components/dashboard/NeedsAttention';
import { UnclosedVisits } from '@/components/dashboard/UnclosedVisits';
import { TodaysRoute } from '@/components/dashboard/TodaysRoute';

// Always read fresh, this is the live "Today" overview.
export const dynamic = 'force-dynamic';

// The daily cron should fire every ~24h; warn when it's been quiet this long.
const CRON_STALE_MS = 36 * 60 * 60 * 1000;

function CronHealth({ lastRunAt }: { lastRunAt: string | null }) {
  const stale = !lastRunAt || Date.now() - new Date(lastRunAt).getTime() > CRON_STALE_MS;
  if (!stale) return null;
  return (
    <div className="mb-6 rounded-card border border-[#ffcdd2] bg-[#ffebee] px-5 py-3 text-sm">
      <span className="font-heading font-bold text-danger">⚠ Daily automations are not running.</span>{' '}
      <span className="text-danger/80">
        {lastRunAt
          ? `Last run ${shortDate(lastRunAt)}.`
          : 'They have never run.'}{' '}
        Visit generation, weekly invoices, and reminders are stalled, check the
        Vercel cron for scoopngohq.
      </span>
    </div>
  );
}

export default async function DashboardPage() {
  const { metrics, needsAttention, unclosedVisits, cronLastRunAt, route } =
    await getDashboardData();

  return (
    <div>
      <PageHeader title="Dashboard" subtitle={dayMonth(todayISO())} />

      <CronHealth lastRunAt={cronLastRunAt} />

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
      <UnclosedVisits items={unclosedVisits} />

      <h2 className="font-heading text-[0.8rem] font-bold text-muted uppercase tracking-wider mb-2">
        Today's route
      </h2>
      <TodaysRoute stops={route} />
    </div>
  );
}
