import { NextResponse } from 'next/server';
import { getReportsData } from '@/components/reports/data';

// GET /api/reports, the same metrics the reports page renders, as JSON.
// Server-only: getReportsData uses the service-role Supabase client.
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await getReportsData();
    return NextResponse.json(data);
  } catch {
    // Never 500 the reports page, return a safe empty shape.
    return NextResponse.json(
      {
        headline: {
          activeClients: 0,
          mrrEstimate: 0,
          collectedThisMonth: 0,
          outstandingAR: 0,
        },
        monthlyRevenue: [],
        arAging: [],
        leadFunnel: {
          counts: { new: 0, contacted: 0, converted: 0, lost: 0 },
          total: 0,
          conversionRate: 0,
        },
        weeklyVisits: [],
        weeklyRevenue: [],
        clientRevenue: [],
        degraded: true,
      },
      { status: 200 }
    );
  }
}
