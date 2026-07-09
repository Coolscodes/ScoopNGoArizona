#!/usr/bin/env node
/**
 * scoopngo-mcp-server: read-only MCP access to ScoopNGo Arizona ops data.
 *
 * Tools cover clients, the day's route, visit history, accounts receivable,
 * revenue, and leads. Everything is READ-ONLY by design: money actions
 * (charging cards, editing invoices) stay in the HQ app where they have
 * confirmation UI and an audit trail.
 *
 * Env: SUPABASE_URL + SUPABASE_SERVICE_KEY. If unset, the server tries to
 * load them from ../hq/.env.local (the HQ app's env file) so local setup
 * needs zero extra configuration.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

// --- env ---------------------------------------------------------------------

function loadHqEnvFallback(): void {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) return;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const envPath = resolve(here, "../../hq/.env.local");
    const text = readFileSync(envPath, "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (!m) continue;
      const [, key, value] = m;
      if (key === "NEXT_PUBLIC_SUPABASE_URL" && !process.env.SUPABASE_URL) {
        process.env.SUPABASE_URL = value.trim();
      }
      if (key === "SUPABASE_SERVICE_KEY" && !process.env.SUPABASE_SERVICE_KEY) {
        process.env.SUPABASE_SERVICE_KEY = value.trim();
      }
    }
  } catch {
    // No fallback file; the startup check below reports what's missing.
  }
}

let _sb: SupabaseClient | null = null;
function sb(): SupabaseClient {
  if (_sb) return _sb;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_KEY are required (or run next to hq/.env.local)"
    );
  }
  _sb = createClient(url, key, { auth: { persistSession: false } });
  return _sb;
}

// --- shared helpers ------------------------------------------------------------

const PHOENIX_TZ = "America/Phoenix";

/** Today's date (YYYY-MM-DD) in Arizona time, matching the HQ app. */
function todayISO(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: PHOENIX_TZ });
}

function fullName(c: { first_name?: string | null; last_name?: string | null }): string {
  return `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Unnamed";
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CustomerRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  zip: string | null;
  gate_code: string | null;
  yard_notes: string | null;
  service_type: string | null;
  preferred_day: string | null;
  price_per_visit: number | null;
  active: boolean;
  frequency_weeks: number | null;
  next_visit_date: string | null;
  route_order: number | null;
  flags: string[] | null;
  auto_charge: boolean | null;
  stripe_customer_id: string | null;
}

function clientSummary(c: CustomerRow) {
  return {
    id: c.id,
    name: fullName(c),
    phone: c.phone,
    email: c.email,
    address: [c.address, c.city, c.zip].filter(Boolean).join(", ") || null,
    service_type: c.service_type,
    preferred_day: c.preferred_day,
    price_per_visit: c.price_per_visit,
    frequency_weeks: c.frequency_weeks,
    next_visit_date: c.next_visit_date,
    active: c.active,
    has_card: Boolean(c.stripe_customer_id),
    auto_charge: Boolean(c.auto_charge),
    flags: c.flags ?? [],
  };
}

/** Fetch customers by id and return a lookup map (shared by several tools). */
async function customerMap(ids: string[]): Promise<Map<string, CustomerRow>> {
  const map = new Map<string, CustomerRow>();
  if (ids.length === 0) return map;
  const { data, error } = await sb()
    .from("customers")
    .select("*")
    .in("id", Array.from(new Set(ids)));
  if (error) throw error;
  for (const c of (data ?? []) as CustomerRow[]) map.set(c.id, c);
  return map;
}

type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function ok(output: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
    structuredContent: output,
  };
}

function fail(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

// --- server --------------------------------------------------------------------

const server = new McpServer({
  name: "scoopngo-mcp-server",
  version: "1.0.0",
});

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

// 1) list clients
server.registerTool(
  "scoopngo_list_clients",
  {
    title: "List ScoopNGo Clients",
    description: `List ScoopNGo clients with optional filters. Read-only.

Args:
  - search (string, optional): match against first or last name (partial, case-insensitive)
  - active (boolean, default true): only active clients; pass false for inactive only
  - day (string, optional): filter by preferred service day, e.g. "Tuesday"
  - auto_charge (boolean, optional): filter by charge-on-completion opt-in
  - limit (1-100, default 50) / offset (default 0)

Returns { count, clients: [{ id, name, phone, email, address, service_type, preferred_day, price_per_visit, frequency_weeks, next_visit_date, active, has_card, auto_charge, flags }] }.
Use scoopngo_get_client for one client's full detail (dogs, visits, open invoices).`,
    inputSchema: {
      search: z.string().max(80).optional().describe("Partial name match"),
      active: z.boolean().default(true).describe("Filter by active status"),
      day: z.string().optional().describe('Preferred service day, e.g. "Tuesday"'),
      auto_charge: z.boolean().optional().describe("Filter by auto-charge opt-in"),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
    },
    annotations: READ_ONLY,
  },
  async (params) => {
    try {
      let q = sb()
        .from("customers")
        .select("*")
        .eq("active", params.active)
        .order("first_name", { ascending: true })
        .range(params.offset, params.offset + params.limit - 1);
      if (params.day) q = q.eq("preferred_day", params.day);
      if (params.auto_charge !== undefined) q = q.eq("auto_charge", params.auto_charge);
      if (params.search) {
        q = q.or(
          `first_name.ilike.%${params.search}%,last_name.ilike.%${params.search}%`
        );
      }
      const { data, error } = await q;
      if (error) throw error;
      const clients = ((data ?? []) as CustomerRow[]).map(clientSummary);
      return ok({ count: clients.length, offset: params.offset, clients });
    } catch (e) {
      return fail(e);
    }
  }
);

// 2) client detail
server.registerTool(
  "scoopngo_get_client",
  {
    title: "Get ScoopNGo Client Detail",
    description: `Full detail for one client: profile, dogs, last 5 completed visits, open (unpaid) invoices, and upcoming appointments. Read-only.

Args:
  - client (string): a client id (UUID) or a name to search (first match wins)

Returns { client, dogs, recent_visits, open_invoices, upcoming_appointments } or an error listing near-matches if the name is ambiguous.`,
    inputSchema: {
      client: z.string().min(1).describe("Client UUID or partial name"),
    },
    annotations: READ_ONLY,
  },
  async ({ client }) => {
    try {
      let row: CustomerRow | null = null;
      if (UUID_RE.test(client)) {
        const { data, error } = await sb()
          .from("customers")
          .select("*")
          .eq("id", client)
          .maybeSingle();
        if (error) throw error;
        row = data as CustomerRow | null;
      } else {
        const { data, error } = await sb()
          .from("customers")
          .select("*")
          .or(`first_name.ilike.%${client}%,last_name.ilike.%${client}%`)
          .limit(5);
        if (error) throw error;
        const matches = (data ?? []) as CustomerRow[];
        if (matches.length > 1) {
          return ok({
            ambiguous: true,
            message: `Multiple clients match "${client}". Call again with an id.`,
            matches: matches.map((m) => ({ id: m.id, name: fullName(m) })),
          });
        }
        row = matches[0] ?? null;
      }
      if (!row) {
        return fail(new Error(`No client found for "${client}". Try scoopngo_list_clients.`));
      }

      const [dogs, visits, invoices, appts] = await Promise.all([
        sb().from("dogs").select("name, breed, notes").eq("customer_id", row.id),
        sb()
          .from("service_logs")
          .select("completed_at, technician_notes, issue_flagged, issue_details, gate_photo_url")
          .eq("customer_id", row.id)
          .order("completed_at", { ascending: false })
          .limit(5),
        sb()
          .from("invoices")
          .select("id, amount, status, due_date, period_start, period_end, notes")
          .eq("customer_id", row.id)
          .in("status", ["sent", "overdue", "draft"]),
        sb()
          .from("appointments")
          .select("id, scheduled_at, status, service_type")
          .eq("customer_id", row.id)
          .gte("scheduled_at", todayISO())
          .order("scheduled_at", { ascending: true })
          .limit(5),
      ]);
      for (const r of [dogs, visits, invoices, appts]) {
        if (r.error) throw r.error;
      }

      return ok({
        client: { ...clientSummary(row), gate_code: row.gate_code, yard_notes: row.yard_notes },
        dogs: dogs.data ?? [],
        recent_visits: visits.data ?? [],
        open_invoices: invoices.data ?? [],
        upcoming_appointments: appts.data ?? [],
      });
    } catch (e) {
      return fail(e);
    }
  }
);

// 3) route for a date
server.registerTool(
  "scoopngo_get_route",
  {
    title: "Get ScoopNGo Route",
    description: `The route (appointments) for a given date, in route order, with client name, address, gate code, dogs, flags, and status. Read-only.

Args:
  - date (string, optional): YYYY-MM-DD; defaults to today in Arizona time

Returns { date, stop_count, done_count, stops: [...] }.`,
    inputSchema: {
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
        .optional()
        .describe("Route date, defaults to today (Arizona)"),
    },
    annotations: READ_ONLY,
  },
  async ({ date }) => {
    try {
      const day = date ?? todayISO();
      const { data, error } = await sb()
        .from("appointments")
        .select("id, customer_id, status, service_type, route_position, notes")
        .eq("scheduled_at", day);
      if (error) throw error;
      const appts = (data ?? []) as {
        id: string;
        customer_id: string;
        status: string;
        service_type: string | null;
        route_position: number | null;
        notes: string | null;
      }[];
      const custs = await customerMap(appts.map((a) => a.customer_id));

      const orderOf = (a: (typeof appts)[number]) =>
        a.route_position ?? custs.get(a.customer_id)?.route_order ?? Number.POSITIVE_INFINITY;
      appts.sort((a, b) => orderOf(a) - orderOf(b));

      const stops = appts.map((a, i) => {
        const c = custs.get(a.customer_id);
        return {
          position: i + 1,
          appointment_id: a.id,
          status: a.status,
          client_id: a.customer_id,
          client: c ? fullName(c) : "Unknown",
          address: c ? [c.address, c.city].filter(Boolean).join(", ") || null : null,
          gate_code: c?.gate_code ?? null,
          phone: c?.phone ?? null,
          flags: c?.flags ?? [],
          auto_charge: Boolean(c?.auto_charge),
          service_type: a.service_type ?? c?.service_type ?? null,
          notes: a.notes,
        };
      });
      return ok({
        date: day,
        stop_count: stops.length,
        done_count: stops.filter((s) => s.status === "completed").length,
        stops,
      });
    } catch (e) {
      return fail(e);
    }
  }
);

// 4) visit history
server.registerTool(
  "scoopngo_list_visits",
  {
    title: "List ScoopNGo Visits",
    description: `Completed visit logs, newest first. Read-only.

Args:
  - client (string, optional): client UUID to filter by
  - since (string, optional): YYYY-MM-DD; only visits on/after this date
  - issues_only (boolean, default false): only visits with a flagged issue
  - limit (1-100, default 20)

Returns { count, visits: [{ completed_at, client, notes, issue_flagged, issue_details, has_photo }] }.`,
    inputSchema: {
      client: z.string().uuid().optional().describe("Client UUID"),
      since: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
        .optional(),
      issues_only: z.boolean().default(false),
      limit: z.number().int().min(1).max(100).default(20),
    },
    annotations: READ_ONLY,
  },
  async (params) => {
    try {
      let q = sb()
        .from("service_logs")
        .select("customer_id, completed_at, technician_notes, issue_flagged, issue_details, gate_photo_url")
        .order("completed_at", { ascending: false })
        .limit(params.limit);
      if (params.client) q = q.eq("customer_id", params.client);
      if (params.since) q = q.gte("completed_at", params.since);
      if (params.issues_only) q = q.eq("issue_flagged", true);
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as {
        customer_id: string;
        completed_at: string;
        technician_notes: string | null;
        issue_flagged: boolean;
        issue_details: string | null;
        gate_photo_url: string | null;
      }[];
      const custs = await customerMap(rows.map((r) => r.customer_id));
      const visits = rows.map((r) => ({
        completed_at: r.completed_at,
        client_id: r.customer_id,
        client: custs.get(r.customer_id) ? fullName(custs.get(r.customer_id)!) : "Unknown",
        notes: r.technician_notes,
        issue_flagged: r.issue_flagged,
        issue_details: r.issue_details,
        has_photo: Boolean(r.gate_photo_url),
      }));
      return ok({ count: visits.length, visits });
    } catch (e) {
      return fail(e);
    }
  }
);

// 5) accounts receivable
server.registerTool(
  "scoopngo_ar_summary",
  {
    title: "ScoopNGo Accounts Receivable",
    description: `Who owes money: all open ('sent' or 'overdue') invoices grouped by client, biggest balance first. Read-only.

Returns { total_open, client_count, clients: [{ client_id, client, phone, total_open, invoices: [{ id, amount, status, due_date, period_start, notes }] }] }.`,
    inputSchema: {},
    annotations: READ_ONLY,
  },
  async () => {
    try {
      const { data, error } = await sb()
        .from("invoices")
        .select("id, customer_id, amount, status, due_date, period_start, notes")
        .in("status", ["sent", "overdue"])
        .order("due_date", { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as {
        id: string;
        customer_id: string;
        amount: number;
        status: string;
        due_date: string | null;
        period_start: string | null;
        notes: string | null;
      }[];
      const custs = await customerMap(rows.map((r) => r.customer_id));
      const byClient = new Map<string, { total: number; invoices: typeof rows }>();
      for (const r of rows) {
        const entry = byClient.get(r.customer_id) ?? { total: 0, invoices: [] };
        entry.total += r.amount ?? 0;
        entry.invoices.push(r);
        byClient.set(r.customer_id, entry);
      }
      const clients = Array.from(byClient.entries())
        .map(([id, { total, invoices }]) => ({
          client_id: id,
          client: custs.get(id) ? fullName(custs.get(id)!) : "Unknown",
          phone: custs.get(id)?.phone ?? null,
          total_open: Math.round(total * 100) / 100,
          invoices: invoices.map(({ customer_id: _cid, ...inv }) => inv),
        }))
        .sort((a, b) => b.total_open - a.total_open);
      const totalOpen = clients.reduce((s, c) => s + c.total_open, 0);
      return ok({
        total_open: Math.round(totalOpen * 100) / 100,
        client_count: clients.length,
        clients,
      });
    } catch (e) {
      return fail(e);
    }
  }
);

// 6) revenue summary
server.registerTool(
  "scoopngo_revenue_summary",
  {
    title: "ScoopNGo Revenue Summary",
    description: `Payments received in a date range: total, count, breakdown by payment method, and per-day subtotals. Read-only.

Args:
  - from (string, optional): YYYY-MM-DD, default first day of the current month (Arizona)
  - to (string, optional): YYYY-MM-DD inclusive, default today

Returns { from, to, total, payment_count, by_method, by_day }.`,
    inputSchema: {
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional(),
    },
    annotations: READ_ONLY,
  },
  async ({ from, to }) => {
    try {
      const today = todayISO();
      const fromDate = from ?? `${today.slice(0, 7)}-01`;
      const toDate = to ?? today;
      const { data, error } = await sb()
        .from("payments")
        .select("amount, method, paid_at")
        .gte("paid_at", fromDate)
        .lt("paid_at", `${toDate}T23:59:59.999`)
        .order("paid_at", { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as { amount: number; method: string | null; paid_at: string }[];
      const byMethod: Record<string, number> = {};
      const byDay: Record<string, number> = {};
      let total = 0;
      for (const r of rows) {
        total += r.amount ?? 0;
        const method = r.method ?? "unknown";
        byMethod[method] = Math.round(((byMethod[method] ?? 0) + r.amount) * 100) / 100;
        const day = r.paid_at.slice(0, 10);
        byDay[day] = Math.round(((byDay[day] ?? 0) + r.amount) * 100) / 100;
      }
      return ok({
        from: fromDate,
        to: toDate,
        total: Math.round(total * 100) / 100,
        payment_count: rows.length,
        by_method: byMethod,
        by_day: byDay,
      });
    } catch (e) {
      return fail(e);
    }
  }
);

// 7) leads
server.registerTool(
  "scoopngo_list_leads",
  {
    title: "List ScoopNGo Leads",
    description: `Quote-request leads from the marketing site, newest first. Read-only.

Args:
  - status ('new' | 'contacted' | 'converted' | 'lost', optional): filter by pipeline status
  - limit (1-100, default 20)

Returns { count, leads: [{ id, created_at, name, phone, email, zip, dogs, service_type, notes, status }] }.`,
    inputSchema: {
      status: z.enum(["new", "contacted", "converted", "lost"]).optional(),
      limit: z.number().int().min(1).max(100).default(20),
    },
    annotations: READ_ONLY,
  },
  async ({ status, limit }) => {
    try {
      let q = sb()
        .from("leads")
        .select("id, created_at, first_name, last_name, phone, email, zip, dogs, service_type, notes, status")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (status) q = q.eq("status", status);
      const { data, error } = await q;
      if (error) throw error;
      const leads = ((data ?? []) as (CustomerRow & {
        created_at: string;
        dogs: string;
        notes: string | null;
        status: string;
      })[]).map((l) => ({
        id: l.id,
        created_at: l.created_at,
        name: fullName(l),
        phone: l.phone,
        email: l.email,
        zip: l.zip,
        dogs: l.dogs,
        service_type: l.service_type,
        notes: l.notes,
        status: l.status,
      }));
      return ok({ count: leads.length, leads });
    } catch (e) {
      return fail(e);
    }
  }
);

// --- main ----------------------------------------------------------------------

async function main(): Promise<void> {
  loadHqEnvFallback();
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error(
      "ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY are required (set them or keep hq/.env.local in place)"
    );
    process.exit(1);
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("scoopngo-mcp-server running via stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
