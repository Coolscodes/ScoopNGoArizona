import { PageHeader, StatCard } from '@/components/ui';
import { money } from '@/lib/format';
import { getReportsData } from '@/components/reports/data';
import { MonthlyRevenueChart } from '@/components/reports/MonthlyRevenueChart';
import { ArAgingChart } from '@/components/reports/ArAgingChart';
import { LeadFunnelChart } from '@/components/reports/LeadFunnelChart';
import { WeeklyVisitsChart } from '@/components/reports/WeeklyVisitsChart';
import { WeeklyRevenueChart } from '@/components/reports/WeeklyRevenueChart';
import { ClientRevenueTable } from '@/components/reports/ClientRevenueTable';

// Always read fresh, reports reflect the live books.
export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const { headline, monthlyRevenue, arAging, leadFunnel, weeklyVisits, weeklyRevenue, clientRevenue } =
    await getReportsData();

  return (
    <div>
      <PageHeader title="Reports" subtitle="Revenue, receivables, and route performance at a glance" />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-6">
        <StatCard label="Active clients" value={headline.activeClients} />
        <StatCard label="Est. MRR" value={money(headline.mrrEstimate)} tone="success" />
        <StatCard
          label="Collected this month"
          value={money(headline.collectedThisMonth)}
          tone="success"
        />
        <StatCard label="Outstanding A/R" value={money(headline.outstandingAR)} tone="warn" />
      </div>

      {/* [&>*]:min-w-0 lets each card shrink below its chart's scrollable
          width; otherwise the SVG min-width forces the page wide on phones. */}
      <div className="grid gap-4 lg:grid-cols-2 mb-4 [&>*]:min-w-0">
        <MonthlyRevenueChart data={monthlyRevenue} />
        <ArAgingChart data={arAging} />
      </div>

      {/* The two weekly charts share a row and an 8 week window, so a week's
          visit count sits directly beside what that week earned. */}
      <div className="grid gap-4 lg:grid-cols-2 mb-4 [&>*]:min-w-0">
        <WeeklyVisitsChart data={weeklyVisits} />
        <WeeklyRevenueChart data={weeklyRevenue} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 mb-4 [&>*]:min-w-0">
        <LeadFunnelChart data={leadFunnel} />
      </div>

      <ClientRevenueTable data={clientRevenue} />
    </div>
  );
}
