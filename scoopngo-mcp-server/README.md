# scoopngo-mcp-server

Read-only MCP server over the ScoopNGo Supabase database. Lets Claude (or any MCP client) answer ops questions directly: who's on today's route, who owes money, revenue this month, new leads, a client's full history.

Read-only by design. Money actions (charging cards, editing invoices) stay in the HQ app, which has confirmation UI and an audit trail.

## Tools

| Tool | What it answers |
| --- | --- |
| `scoopngo_list_clients` | "Show my active Tuesday clients" (filter by name, day, auto-charge) |
| `scoopngo_get_client` | "Everything about Sarah": profile, dogs, visits, open invoices, upcoming stops |
| `scoopngo_get_route` | "What's today's route?" (any date, in route order, with gate codes and flags) |
| `scoopngo_list_visits` | "Any flagged issues this week?" (visit logs, newest first) |
| `scoopngo_ar_summary` | "Who owes money?" (open invoices grouped by client, biggest first) |
| `scoopngo_revenue_summary` | "Revenue this month?" (totals by method and by day) |
| `scoopngo_list_leads` | "Any new quote requests?" (marketing site leads by status) |

## Setup

```bash
cd scoopngo-mcp-server
npm install
npm run build
```

Env: needs `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`. If they're not set, the server automatically reads them from `../hq/.env.local`, so inside this repo it works with zero config.

The repo's `.mcp.json` already registers it for Claude Code. To register elsewhere:

```json
{
  "mcpServers": {
    "scoopngo": {
      "command": "node",
      "args": ["/Users/jettbrown/Desktop/ScoopNGoArizona/scoopngo-mcp-server/dist/index.js"]
    }
  }
}
```
