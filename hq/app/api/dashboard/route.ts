import { NextResponse } from 'next/server';
import { getDashboardData } from '@/components/dashboard/data';

// GET /api/dashboard — the same metrics the dashboard page renders, as JSON.
// Server-only: getDashboardData uses the service-role Supabase client.
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await getDashboardData();
    return NextResponse.json(data);
  } catch {
    // Never 500 the dashboard — return a safe empty shape.
    return NextResponse.json(
      {
        metrics: {
          todaysStops: 0,
          collectedThisWeek: 0,
          unpaid: 0,
          newRequests: 0,
        },
        needsAttention: [],
        route: [],
        degraded: true,
      },
      { status: 200 }
    );
  }
}
