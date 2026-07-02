// Scoop HQ AI assistant — operator chat grounded in live business data.
//   POST /api/assistant  { message, history }  -> 200 { reply, actions, proposals, needsKey? }
//
// SAFETY: every tool this route can call is read-only (see components/assistant/tools.ts
// and proposals.ts). The propose_* tools only VALIDATE and return proposal cards — real
// execution happens exclusively in /api/assistant/execute after the operator confirms.
// No SMS/email ever — draft_sms only returns text for a human to send.

import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { AI_MODEL, anthropicClient, hasAnthropicKey, NEEDS_KEY_RESPONSE, textFromResponse } from '@/lib/ai';
import { TOOL_EXECUTORS } from '@/components/assistant/tools';
import type { ActionProposal } from '@/components/assistant/proposals';
import { todayISO } from '@/lib/format';

export const dynamic = 'force-dynamic';

const MAX_TOOL_ITERATIONS = 6;
const MAX_HISTORY_TURNS = 12;

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

// Human-readable labels for the "actions" chips shown under assistant replies.
const ACTION_LABELS: Record<string, (input: any) => string> = {
  get_business_snapshot: () => 'Checked the business snapshot',
  search_clients: (input) => `Searched clients for "${input?.query ?? ''}"`,
  get_client_details: () => 'Looked up client details',
  list_unpaid_invoices: () => 'Checked unpaid invoices',
  get_todays_route: () => "Checked today's route",
  draft_sms: (input) => `Drafted an SMS for ${input?.client_name ?? 'a client'}`,
  list_invoices: () => 'Browsed invoice history',
  list_leads: () => 'Checked the lead pipeline',
  propose_update_lead_status: () => 'Prepared: update lead status',
  propose_convert_lead: () => 'Prepared: convert lead to client',
  propose_mark_invoice_paid: () => 'Prepared: mark invoice paid',
  propose_charge_invoice: () => 'Prepared: charge card on file',
  propose_create_invoice: () => 'Prepared: create invoice',
  propose_add_stop_to_route: () => 'Prepared: add stop to route',
  propose_set_appointment_status: () => 'Prepared: update stop status',
};

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_business_snapshot',
    description:
      "Get a compact overview of the whole business right now: active client count, today's route, unpaid invoices, stale leads, this week's collections, and recent service visits. Good first call for broad questions.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'search_clients',
    description:
      'Search clients by name, phone, or email. Returns up to 8 matches, active clients first, with id, name, phone, address, service_type, preferred_day, price_per_visit, flags, and active status.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name, phone, or email fragment to search for.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_client_details',
    description:
      "Get full details for one client by id: profile (contact info, gate code, yard notes, service plan, flags), their dogs, last 5 service logs, last 5 invoices, and total paid all-time. Use search_clients first to find the client_id.",
    input_schema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'The customer id from search_clients.' },
      },
      required: ['client_id'],
    },
  },
  {
    name: 'list_unpaid_invoices',
    description:
      "List all sent or overdue invoices, sorted oldest first, up to 20, with customer name, amount, status, and days old. Use this for 'who owes me money' type questions.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_todays_route',
    description:
      "Get today's appointments in schedule order: customer name, scheduled time, service type, status, admin flags, yard notes, and gate code.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'draft_sms',
    description:
      'Request a drafted SMS for a client. This tool never sends anything — it only returns instructions for you to compose the draft text yourself in your final reply, clearly labeled as a draft for the operator to copy.',
    input_schema: {
      type: 'object',
      properties: {
        client_name: { type: 'string', description: 'The client the SMS is for.' },
        purpose: { type: 'string', description: 'What the text needs to say, e.g. "overdue invoice reminder".' },
        tone: { type: 'string', description: 'Optional tone, e.g. "friendly", "firm".' },
      },
      required: ['client_name', 'purpose'],
    },
  },
  {
    name: 'list_invoices',
    description:
      "Browse invoice history with optional filters — includes PAID invoices (unlike list_unpaid_invoices). Returns up to 25 newest-first with invoice_id, customer, amount, status, dates, and notes. Use client_id (from search_clients) to see one client's history, or status to filter (draft/sent/paid/overdue).",
    input_schema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Optional customer id to filter by.' },
        status: { type: 'string', enum: ['draft', 'sent', 'paid', 'overdue'], description: 'Optional status filter.' },
        limit: { type: 'number', description: 'Max results, up to 25. Default 15.' },
      },
    },
  },
  {
    name: 'list_leads',
    description:
      "List the lead pipeline (up to 25, newest first): lead_id, name, contact info, dogs, requested service, status (new/contacted/converted/lost), days old, and notes. Use for questions about leads, prospects, or new business.",
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['new', 'contacted', 'converted', 'lost'], description: 'Optional status filter.' },
      },
    },
  },
  {
    name: 'propose_update_lead_status',
    description:
      "Prepare (NOT execute) moving a lead to 'new', 'contacted', or 'lost'. Requires lead_id from list_leads. To turn a lead into a paying client, use propose_convert_lead instead. Operator must confirm.",
    input_schema: {
      type: 'object',
      properties: {
        lead_id: { type: 'string', description: 'The lead id from list_leads.' },
        status: { type: 'string', enum: ['new', 'contacted', 'lost'] },
      },
      required: ['lead_id', 'status'],
    },
  },
  {
    name: 'propose_convert_lead',
    description:
      "Prepare (NOT execute) converting a lead into a real client record (copies their info into the client list and marks the lead converted). Requires lead_id from list_leads. Operator must confirm.",
    input_schema: {
      type: 'object',
      properties: {
        lead_id: { type: 'string', description: 'The lead id from list_leads.' },
      },
      required: ['lead_id'],
    },
  },
  {
    name: 'propose_create_invoice',
    description:
      "Prepare (NOT execute) creating a new invoice for a client. Requires client_id from search_clients and a positive dollar amount. Optional: due_date / period_start / period_end (YYYY-MM-DD), notes, and status 'draft' or 'sent' (default sent). The operator must confirm the proposal card before the invoice is created.",
    input_schema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'The customer id from search_clients.' },
        amount: { type: 'number', description: 'Invoice amount in dollars.' },
        due_date: { type: 'string', description: 'Optional YYYY-MM-DD due date.' },
        period_start: { type: 'string', description: 'Optional YYYY-MM-DD service period start.' },
        period_end: { type: 'string', description: 'Optional YYYY-MM-DD service period end.' },
        notes: { type: 'string', description: 'Optional note, e.g. "One-time deep clean".' },
        status: { type: 'string', enum: ['draft', 'sent'], description: 'Default sent.' },
      },
      required: ['client_id', 'amount'],
    },
  },
  {
    name: 'propose_mark_invoice_paid',
    description:
      "Prepare (NOT execute) marking an invoice as paid for money collected outside the app (cash, Venmo, Zelle, check). Call when the operator says a client paid them directly. Requires the invoice_id from list_unpaid_invoices or get_client_details. The operator must confirm the proposal card before anything happens.",
    input_schema: {
      type: 'object',
      properties: {
        invoice_id: { type: 'string', description: 'The invoice id to mark paid.' },
        method: {
          type: 'string',
          enum: ['cash', 'venmo', 'zelle', 'check', 'card'],
          description: 'How the money was collected. Defaults to cash.',
        },
      },
      required: ['invoice_id'],
    },
  },
  {
    name: 'propose_charge_invoice',
    description:
      "Prepare (NOT execute) charging a client's card on file via Stripe for an unpaid invoice. Call when the operator asks to charge someone. Requires invoice_id. Fails cleanly if the client has no card on file. The operator must confirm the proposal card before any charge happens.",
    input_schema: {
      type: 'object',
      properties: {
        invoice_id: { type: 'string', description: 'The unpaid invoice id to charge.' },
      },
      required: ['invoice_id'],
    },
  },
  {
    name: 'propose_add_stop_to_route',
    description:
      "Prepare (NOT execute) adding a client to a specific day's route. Requires client_id from search_clients and a YYYY-MM-DD date (defaults to today). Refuses if they already have a stop that day. The operator must confirm the proposal card.",
    input_schema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'The customer id from search_clients.' },
        date: { type: 'string', description: 'YYYY-MM-DD. Defaults to today.' },
      },
      required: ['client_id'],
    },
  },
  {
    name: 'propose_set_appointment_status',
    description:
      "Prepare (NOT execute) marking a route stop completed, skipped, or back to scheduled. Requires appointment_id from get_todays_route. The operator must confirm the proposal card.",
    input_schema: {
      type: 'object',
      properties: {
        appointment_id: { type: 'string', description: 'The appointment id from get_todays_route.' },
        status: { type: 'string', enum: ['completed', 'skipped', 'scheduled'] },
      },
      required: ['appointment_id', 'status'],
    },
  },
];

function systemPrompt(): string {
  return `You are Scoop HQ, the operations copilot for Scoop N Go Arizona, a pet-waste-removal business. Today's date is ${todayISO()}.

Be concise and numbers-first. Ground every factual answer in tool data — never invent client names, balances, addresses, or other details. If you need information, call a tool before answering; don't guess.

If the operator asks you to text/message/notify a client, use the draft_sms tool, then write the actual SMS draft yourself in your reply. Always clearly label drafts as drafts for the operator to review and send manually — never imply a message was actually sent, because you cannot send messages.

You can also PREPARE real actions with the propose_* tools: create an invoice, mark an invoice paid, charge a card on file, add a stop to a route, change a stop's status, update a lead's status, or convert a lead into a client. Proposals are not executed — each one appears as a card the operator must confirm. After proposing, tell the operator what you prepared and that it's waiting for their confirmation. Never claim an action was completed. Look up the exact ids first (list_unpaid_invoices, search_clients, get_todays_route) — never guess an id.

IMPORTANT — creating an invoice does NOT charge anyone. They are separate steps. When the operator's intent includes collecting the money (e.g. "bill and charge them", "invoice her for last week" for a card-paying client), be explicit that the invoice card only CREATES it, and that charging is a second confirmation. Since charging needs the new invoice's id (which doesn't exist until the create is confirmed), tell the operator: "after you confirm the invoice, say 'charge it' and I'll prepare the charge." Never imply money was collected when only the invoice was created.

Keep replies short and scannable. Plain text only — no markdown (no **bold**, no tables, no headers); the chat renders raw text. Use simple numbered or dashed lines.`;
}

function clampHistory(history: ChatTurn[]): ChatTurn[] {
  if (!Array.isArray(history)) return [];
  const clean = history.filter(
    (t) => t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string'
  );
  return clean.slice(-MAX_HISTORY_TURNS);
}

export async function POST(request: Request) {
  if (!hasAnthropicKey()) {
    return NextResponse.json({ reply: NEEDS_KEY_RESPONSE.text, needsKey: true, actions: [] });
  }

  let body: { message?: string; history?: ChatTurn[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ reply: 'Invalid request body.', actions: [] }, { status: 200 });
  }

  const message = (body.message ?? '').trim();
  if (!message) {
    return NextResponse.json({ reply: 'Ask me something about the business.', actions: [] });
  }

  const history = clampHistory(body.history ?? []);
  const actions: string[] = [];
  const proposals: ActionProposal[] = [];

  try {
    const client = anthropicClient();

    const messages: Anthropic.MessageParam[] = [
      ...history.map((t) => ({ role: t.role, content: t.content } as Anthropic.MessageParam)),
      { role: 'user', content: message },
    ];

    let finalText = '';

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const res = await client.messages.create({
        model: AI_MODEL,
        max_tokens: 1500,
        system: systemPrompt(),
        tools: TOOLS,
        messages,
      });

      if (res.stop_reason !== 'tool_use') {
        finalText = textFromResponse(res);
        break;
      }

      // Append the assistant turn (including tool_use blocks) then execute each
      // tool call and append the results as a user turn of tool_result blocks.
      messages.push({ role: 'assistant', content: res.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of res.content) {
        if (block.type !== 'tool_use') continue;
        const executor = TOOL_EXECUTORS[block.name];
        let output: string;
        if (!executor) {
          output = JSON.stringify({ error: `Unknown tool: ${block.name}` });
        } else {
          try {
            output = await executor(block.input ?? {});
            const label = ACTION_LABELS[block.name]?.(block.input) ?? `Called ${block.name}`;
            actions.push(label);
            // Proposer tools return { __proposal } — surface it to the UI for confirmation.
            try {
              const parsed = JSON.parse(output) as { __proposal?: ActionProposal };
              if (parsed.__proposal) proposals.push(parsed.__proposal);
            } catch {
              // non-JSON output — nothing to collect
            }
          } catch (err) {
            output = JSON.stringify({
              error: err instanceof Error ? err.message : 'Tool execution failed',
            });
          }
        }
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: output });
      }

      messages.push({ role: 'user', content: toolResults });

      // If this was the last allowed iteration, force a final text-only answer.
      if (iteration === MAX_TOOL_ITERATIONS - 1) {
        const wrapUp = await client.messages.create({
          model: AI_MODEL,
          max_tokens: 1500,
          system: systemPrompt(),
          messages,
        });
        finalText = textFromResponse(wrapUp);
      }
    }

    return NextResponse.json({
      reply: finalText || "I wasn't able to put together an answer — try rephrasing.",
      actions,
      proposals,
    });
  } catch (err) {
    return NextResponse.json(
      { reply: 'Something went wrong talking to the assistant. Try again in a moment.', actions: [], proposals: [] },
      { status: 200 }
    );
  }
}
