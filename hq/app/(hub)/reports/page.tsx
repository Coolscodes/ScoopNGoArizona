import { PageHeader, StatCard } from '@/components/ui';
import { money } from '@/lib/format';
import { getReportsData } from '@/components/reports/data';
import { MonthlyRevenueChart } from '@/components/reports/MonthlyRevenueChart';
import { ArAgingChart } from '@/components/reports/ArAgingChart';
import { LeadFunnelChart } from '@/components/reports/LeadFunnelChart';
import { WeeklyVisitsChart } from '@/components/reports/WeeklyVisitsChart';
import { TopClientsTable } from '@/components/reports/TopClientsTable';

// Always read fresh — reports reflect the live books.
export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const { headline, monthlyRevenue, arAging, leadFunnel, weeklyVisits, topClients } =
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

      <div className="grid gap-4 lg:grid-cols-2 mb-4">
        <MonthlyRevenueChart data={monthlyRevenue} />
        <ArAgingChart data={arAging} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 mb-4">
        <LeadFunnelChart data={leadFunnel} />
        <WeeklyVisitsChart data={weeklyVisits} />
      </div>

      <TopClientsTable data={topClients} />
    </div>
  );
}
