// Briefings module — POST /api/ops-brief
//
// Generates the 7am "morning ops brief" for the owner-operator: today's route in one
// line, money watch (outstanding total + oldest unpaid), leads going stale, and one
// top priority for the day. Grounded entirely in getBusinessSnapshot() (read-only).
//
// If ANTHROPIC_API_KEY is not configured, returns NEEDS_KEY_RESPONSE without calling
// Claude. Any Claude failure is caught and returned as plain text (never throws).

import { NextResponse } from 'next/server';
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
  "You write the 7am ops brief for the owner-operator of Scoop N Go Arizona, a pet waste removal company.";

export async function POST() {
  if (!hasAnthropicKey()) {
    return NextResponse.json(NEEDS_KEY_RESPONSE, { status: 200 });
  }

  try {
    const snapshot = await getBusinessSnapshot();

    const client = anthropicClient();
    const res = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 1200,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            "Here is today's business snapshot as JSON:",
            '```json',
            JSON.stringify(snapshot),
            '```',
            '',
            'Write the morning ops brief. Cover, in this order:',
            "1. TODAY'S ROUTE — one line: how many stops, plus any flagged/watch-out clients (pull from each stop's flags/notes, e.g. dog aggressive, gate code issues, cash only).",
            '2. MONEY WATCH — total outstanding across unpaid invoices, then list the 2-3 oldest unpaid with client name, $ amount, and how many days old.',
            '3. LEADS GOING STALE — name + how many days old, for leads that are getting cold.',
            '4. TOP PRIORITY — ONE single top priority for today, stated plainly.',
            '',
            'Style: short, punchy, scannable. Plain text with simple ALL-CAPS or Title Case section labels. No markdown tables, no bullet-heavy nesting, no fluff. Owner is reading this over coffee before driving the route.',
          ].join('\n'),
        },
      ],
    });

    const text = textFromResponse(res);
    return NextResponse.json({ text });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to generate the morning ops brief.';
    return NextResponse.json({ text: `Couldn't generate the ops brief: ${message}` });
  }
}
