// Briefings module — POST /api/ops-review
//
// Generates the reflective "weekly business review": wins with real numbers, revenue
// vs last week, operational issues (flagged visits), collections concerns, a growth
// nudge, and next week's focus. Combines getBusinessSnapshot() with a handful of
// read-only aggregate queries (this week vs previous week, month-to-date, etc).
//
// If ANTHROPIC_API_KEY is not configured, returns NEEDS_KEY_RESPONSE without calling
// Claude. Any Claude failure is caught and returned as plain text (never throws).

import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { weekBounds } from '@/lib/format';
import {
  AI_MODEL,
  anthropicClient,
  hasAnthropicKey,
  getBusinessSnapshot,
  NEEDS_KEY_RESPONSE,
  textFromResponse,
} from '@/lib/ai';

export const dynamic = 'force-dynamic';

const SYSTEM_PROMPT =
  "You write the weekly business review for the owner-operator of Scoop N Go Arizona, a pet waste removal company.";

function sumAmount(rows: { amount?: number | null }[] | null | undefined): number {
  return (rows ?? []).reduce((s, r) => s + (r.amount ?? 0), 0);
}

export async function POST() {
  if (!hasAnthropicKey()) {
    return NextResponse.json(NEEDS_KEY_RESPONSE, { status: 200 });
  }

  try {
    const db = supabaseServer();

    const thisWeek = weekBounds(new Date());
    const lastWeekRef = new Date();
    lastWeekRef.setDate(lastWeekRef.getDate() - 7);
    const prevWeek = weekBounds(lastWeekRef);

    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    const [
      snapshot,
      paymentsThisWeekRes,
      paymentsPrevWeekRes,
      logsThisWeekRes,
      newCustomersRes,
      inactiveCustomersRes,
      leadsRes,
    ] = await Promise.all([
      getBusinessSnapshot(),
      db
        .from('payments')
        .select('amount, paid_at')
        .gte('paid_at', `${thisWeek.start}T00:00:00`)
        .lte('paid_at', `${thisWeek.end}T23:59:59`),
      db
        .from('payments')
        .select('amount, paid_at')
        .gte('paid_at', `${prevWeek.start}T00:00:00`)
        .lte('paid_at', `${prevWeek.end}T23:59:59`),
      db
        .from('service_logs')
        .select('customer_id, completed_at, issue_flagged, issue_details')
        .gte('completed_at', `${thisWeek.start}T00:00:00`)
        .lte('completed_at', `${thisWeek.end}T23:59:59`),
      db
        .from('customers')
        .select('id, created_at')
        .gte('created_at', `${monthStart}T00:00:00`),
      db.from('customers').select('id, active').eq('active', false),
      db.from('leads').select('id, status'),
    ]);

    const paymentsThisWeek = sumAmount(paymentsThisWeekRes.data);
    const paymentsPrevWeek = sumAmount(paymentsPrevWeekRes.data);

    const logsThisWeek = logsThisWeekRes.data ?? [];
    const visitsCompleted = logsThisWeek.length;
    const issuesFlagged = logsThisWeek.filter((l) => l.issue_flagged).length;
    const issueDetails = logsThisWeek
      .filter((l) => l.issue_flagged && l.issue_details)
      .map((l) => l.issue_details);

    const newCustomersThisMonth = (newCustomersRes.data ?? []).length;
    const inactiveCustomers = (inactiveCustomersRes.data ?? []).length;

    const leadCounts: Record<string, number> = {};
    for (const l of leadsRes.data ?? []) {
      const status = (l as { status?: string }).status ?? 'unknown';
      leadCounts[status] = (leadCounts[status] ?? 0) + 1;
    }

    const aggregates = {
      week: { start: thisWeek.start, end: thisWeek.end },
      previousWeek: { start: prevWeek.start, end: prevWeek.end },
      paymentsThisWeek,
      paymentsPrevWeek,
      revenueChangePct:
        paymentsPrevWeek > 0
          ? Math.round(((paymentsThisWeek - paymentsPrevWeek) / paymentsPrevWeek) * 100)
          : null,
      visitsCompletedThisWeek: visitsCompleted,
      issuesFlaggedThisWeek: issuesFlagged,
      issueDetails,
      newCustomersThisMonth,
      inactiveCustomers,
      leadStatusCounts: leadCounts,
    };

    const client = anthropicClient();
    const res = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 1200,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            'Here is the live business snapshot as JSON:',
            '```json',
            JSON.stringify(snapshot),
            '```',
            '',
            'Here are this-week aggregates (Mon-Sun) as JSON:',
            '```json',
            JSON.stringify(aggregates),
            '```',
            '',
            'Write the WEEKLY BUSINESS REVIEW. Cover, in this order:',
            '1. WINS — real numbers: revenue collected this week, visits completed, new customers this month.',
            '2. REVENUE VS LAST WEEK — compare paymentsThisWeek to paymentsPrevWeek, call out the direction and rough size of the change (use revenueChangePct if present).',
            '3. OPERATIONAL ISSUES — flagged visits this week (issuesFlaggedThisWeek out of visitsCompletedThisWeek), mention specific issueDetails if any stand out.',
            '4. COLLECTIONS CONCERNS — reference unpaidInvoices from the snapshot: total outstanding and any client that is significantly overdue.',
            '5. GROWTH NUDGE — one honest, concrete suggestion tied to the leadStatusCounts or inactiveCustomers numbers.',
            "6. NEXT WEEK'S FOCUS — one clear focus area.",
            '',
            'Tone: warm but honest — an owner-operator reviewing their own week, not a hype machine. Plain text with simple section labels, no markdown tables. Be specific with the numbers given; do not invent numbers not present in the data.',
          ].join('\n'),
        },
      ],
    });

    const text = textFromResponse(res);
    return NextResponse.json({ text });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to generate the weekly business review.';
    return NextResponse.json({ text: `Couldn't generate the weekly review: ${message}` });
  }
}
