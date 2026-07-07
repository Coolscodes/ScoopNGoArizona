# Scoop N Go HQ, Operations Hub Build Plan

A self-built "Jobber clone" to run Scoop N Go Arizona, living in the website backend.
Built as an **isolated Next.js app** on top of the existing **Supabase** database and the
existing **Vercel/Stripe** payment functions. The public marketing site is **not touched**
until you approve a cutover.

> **How to use this doc.** It is split into **Workstream 0 (Foundation)** plus **Workstreams 1 to 8**.
> Workstream 0 must be built and merged **first, alone**, everything else imports it.
> After that, Workstreams 1 to 8 can be built **at the same time by separate agents**, because each
> one owns its **own folders** and never edits another workstream's files. To dispatch an agent,
> open a new tab and paste that workstream's **kickoff prompt** (bottom of each section).

---

## 1. Architecture at a glance

| Layer | Choice | Notes |
|---|---|---|
| Frontend | **Next.js (App Router) + TypeScript** | New app in `/hq`. You already build in Next.js. |
| Styling | **Tailwind CSS** + a shared UI kit | Brand greens in `tailwind.config.ts`. Agents compose classes → low conflict. |
| Database | **Existing Supabase Postgres** | Additive migration only. Existing tables/data untouched. |
| Auth (staff) | **Supabase Auth** | Replaces the single `ADMIN_PASSWORD`. Roles: `owner`, `tech`. |
| Payments | **Existing Vercel Stripe functions**, ported into `/hq/app/api` | The auto-charge flow is your most-tested code. Reuse, don't rewrite. |
| Email | **Resend** (already wired) | |
| SMS (new) | **Twilio** | Only Workstream 8 touches this. |
| Hosting | New Vercel project (or `hq.scoopngoarizona.com` subdomain) | Keeps the live site isolated until cutover. |

**The app lives entirely in `/hq`.** The existing root files (`index.html`, `admin.html`, the
current `/api`) are left in place and keep running until you choose to retire `admin.html`.

---

## 2. Global rules for parallel agents (READ FIRST)

These rules are what make simultaneous work safe. Every agent must follow them.

1. **Own only your folders.** Each workstream lists an **Owns** section. Create and edit files
   **only** inside those paths. Never edit a file outside them.
2. **Shared files are frozen after Foundation.** `lib/types.ts`, `lib/supabase.ts`, `lib/stripe.ts`,
   `tailwind.config.ts`, `app/globals.css`, `package.json`, `.env.example`, and the SQL migration
   are owned by **Workstream 0** and must **not** be modified by Workstreams 1 to 8. If you think you
   need a new type or dependency, it almost certainly already exists in Foundation, re-read it. If
   it genuinely does not, add it in your branch and note it in your PR description; additions to
   these files merge cleanly, edits to existing lines do not.
3. **Code to the contract, not to other workstreams.** Your only dependencies are the **database
   schema** (Appendix B) and the **TypeScript types** (Appendix A). Do not import another
   workstream's components. If you need data another workstream produces (e.g. the customer portal
   needs visit photos), read it from the database via the shared types.
4. **Server reads use the server Supabase client** (`lib/supabase.ts` → `supabaseServer()`), which
   uses the service-role key. **This key is server-only**, never import it into a client component
   or expose it to the browser. Client components call your own `app/api/...` route handlers.
5. **One accent action per screen; match the brand.** Use the shared UI kit and Tailwind brand
   tokens. Greens: `brand` `#1b5e20` / `brand-mid` `#2e7d32` / `brand-light` `#e8f5e9`. Headings in
   a Montserrat-equivalent, body in Open Sans (configured in Foundation).
6. **Definition of done = it runs.** Start the dev server, load your screens, confirm no console
   errors, and verify against your **Acceptance** checklist before you commit.
7. **Commit to your own branch** named `ws<N>-<slug>` (e.g. `ws1-dashboard`). Because folders don't
   overlap, branches merge into `main` in any order with no conflicts.

---

## 3. Build order & git strategy

```
Step 1 (alone):     Workstream 0, Foundation   → merge to main, deploy preview
Step 2 (parallel):  Workstreams 1, 2, 3, 4, 5, 6, 7, 8  → each on its own branch
Step 3:             Merge branches in any order; smoke-test; deploy preview
Step 4 (you decide): Point /admin or hq. subdomain at the new app (cutover)
```

- **Workstream 0 is the only hard prerequisite.** Do not start 1 to 8 until it is merged.
- A few **soft** integration points exist (noted per workstream). They never block parallel work;
  build against the shared types and the seams line up. Example: the customer portal (7) shows
  visit photos from (5) and a pay button from (6); until those land it reads real rows that may be
  empty, which is fine.
- Recommended: each agent works on its own branch. If you prefer, agents can work on `main`
  simultaneously since files don't overlap, branches are just safer.

---

## 4. Workstream 0, Foundation (build first, alone)

**Goal:** stand up the Next.js app, auth, the shared database/types/UI contracts, and the app
shell with the full navigation, so every other workstream has a stable base to build on.

**Owns (creates all of this):**
```
hq/package.json, tsconfig.json, next.config.js, .env.example, .gitignore
hq/tailwind.config.ts, postcss.config.js
hq/app/globals.css                      ← brand tokens, fonts
hq/app/layout.tsx                       ← root layout, fonts
hq/app/(auth)/login/page.tsx            ← Supabase Auth login
hq/app/(hub)/layout.tsx                 ← app shell: top nav with ALL tabs, auth guard
hq/app/(hub)/page.tsx                   ← redirect to /dashboard
hq/middleware.ts                        ← session refresh / route protection
hq/lib/supabase.ts                      ← supabaseBrowser() + supabaseServer()
hq/lib/stripe.ts                        ← Stripe client + shared helpers
hq/lib/types.ts                         ← ALL entity types (Appendix A)
hq/lib/auth.ts                          ← getCurrentUser(), role helpers
hq/lib/format.ts                        ← money/date/phone formatters
hq/components/ui/*                       ← Button, Card, StatCard, Badge, Pill, Table,
                                           EmptyState, Drawer, Modal, FormField, Avatar,
                                           StatusPill, Toast, PageHeader
hq/supabase/migrations/001_ops_hub.sql  ← full additive migration (Appendix B)
```

**Tasks:**
1. Scaffold Next.js + TypeScript + Tailwind in `/hq`. Install **all** dependencies in Appendix E
   (so feature agents never touch `package.json`).
2. Configure Tailwind theme with the brand palette and fonts (Appendix C of the design tokens).
3. Build `lib/supabase.ts`: a browser client (anon key) and a server client (service-role key,
   server-only). Read `SUPABASE_URL` from env (currently hardcoded in the old functions).
4. Build Supabase Auth: login page (email + password or magic link), `middleware.ts` to protect
   `(hub)` routes, `lib/auth.ts` for the current user + role.
5. Build the **app shell** `(hub)/layout.tsx`: brand top bar + the full nav (Appendix D). Every tab
   links to its route even though feature pages don't exist yet (they 404 until built, expected).
6. Build the **UI kit** in `components/ui`, the shared primitives every workstream uses.
7. Write `lib/types.ts` verbatim from **Appendix A**.
8. Write `supabase/migrations/001_ops_hub.sql` from **Appendix B** and **run it against Supabase**.
9. Seed one `technicians` row for the owner (you) and link it to your auth user.

**Acceptance:**
- `npm run dev` serves the app; visiting any `(hub)` route while logged out redirects to `/login`.
- After login, the app shell renders with all nav tabs; the dashboard route is reachable (empty).
- The migration has run; `select` on the new tables/columns succeeds.
- No secrets are referenced in any client component.

**Kickoff prompt:**
> You are building **Workstream 0 (Foundation)** of the Scoop N Go HQ ops hub. Read
> `/Users/jettbrown/Desktop/ScoopNGoArizona/OPS_HUB_PLAN.md` in full, especially sections 1 to 4 and
> Appendices A to E. Scaffold the Next.js app in `/hq` exactly as described, install all dependencies
> from Appendix E, build the auth, shared lib, UI kit, app shell with the full nav, and write +
> run the SQL migration. Follow the Global Rules in section 2. When done, run the dev server,
> verify the Acceptance checklist, and commit to branch `ws0-foundation`. Do not build any feature
> pages (those are Workstreams 1 to 8).

---

## 5. Workstreams 1 to 8 (parallel)

Each section: **Goal · Owns · Reads/Writes · Screens & Endpoints · Acceptance · Kickoff prompt.**
All of them depend only on Workstream 0.

### Workstream 1, Dashboard ("Today")

**Goal:** the morning overview, metric cards, a needs-attention strip, and today's route summary.

**Owns:**
```
hq/app/(hub)/dashboard/page.tsx
hq/app/api/dashboard/route.ts
hq/components/dashboard/*
```
**Reads:** `appointments`, `invoices`, `payments`, `leads`, `customers`. **Writes:** none.
**Screens & endpoints:**
- Metric cards: today's stops (appointments where `scheduled_at = today`), collected this week
  (sum of `payments` this week), unpaid (sum of `invoices` where status in `sent`/`overdue`),
  new requests (`leads` where status = `new`).
- Needs-attention strip: failed charges (most recent unpaid/overdue with a card on file).
- Today's route list (read-only summary; ordering owned by Workstream 2, read `route_position`).
**Acceptance:** numbers match hand-checked Supabase queries; empty states render; no writes.
**Kickoff prompt:**
> You are building **Workstream 1 (Dashboard)** of the Scoop N Go HQ ops hub. Read
> `/Users/jettbrown/Desktop/ScoopNGoArizona/OPS_HUB_PLAN.md`, Global Rules (section 2), Workstream
> 1, and Appendices A to B. Foundation (Workstream 0) is merged. Build only the files under your
> "Owns" list, importing shared types/UI/Supabase from `/hq/lib` and `/hq/components/ui`. Do not
> edit shared or other workstreams' files. Verify the Acceptance checklist, then commit to
> `ws1-dashboard`.

### Workstream 2, Route & scheduling

**Goal:** the day route view (ordered stops, drag-to-reorder, mark done) and the recurring-visit
generator that creates weekly appointments from each client's plan.

**Owns:**
```
hq/app/(hub)/route/page.tsx
hq/app/api/route/route.ts            (list a day, reorder, mark stop done)
hq/app/api/jobs/generate/route.ts    (cron: generate upcoming appointments)
hq/components/route/*
```
**Reads:** `appointments`, `customers`, `technicians`. **Writes:** `appointments`
(`route_position`, `status`, `assigned_to`, new rows from the generator).
**Screens & endpoints:**
- Day picker → ordered list of that day's `appointments` by `route_position`.
- Drag to reorder → PATCH `route_position`. Mark stop done → set `status = completed`.
- Generator: for each active customer, create the next appointment based on `preferred_day`,
  `frequency_weeks`, and `next_visit_date`; advance `next_visit_date`. Protect with `CRON_SECRET`.
**Acceptance:** reorder persists; mark-done persists; generator is idempotent (no duplicates for a
date already generated). Map/drive-time is explicitly **out of scope** for now.
**Kickoff prompt:**
> You are building **Workstream 2 (Route & scheduling)** of the Scoop N Go HQ ops hub. Read
> `/Users/jettbrown/Desktop/ScoopNGoArizona/OPS_HUB_PLAN.md`, Global Rules, Workstream 2,
> Appendices A to B. Foundation is merged. Build only your "Owns" files. Honor the shared types and
> schema; do not modify them. Verify Acceptance, commit to `ws2-route`.

### Workstream 3, Clients (CRM)

**Goal:** client list + the rich client detail screen (contact, dogs, gate/yard access, billing
snapshot, visit history) with add/edit.

**Owns:**
```
hq/app/(hub)/clients/page.tsx
hq/app/(hub)/clients/[id]/page.tsx
hq/app/api/clients/route.ts
hq/app/api/clients/[id]/route.ts
hq/components/clients/*
```
**Reads/Writes:** `customers`, `dogs` (full CRUD); reads `appointments`, `service_logs`, `invoices`
for the history panel; reads card-on-file status from `customers.stripe_customer_id`.
**Screens & endpoints:**
- List with search/filter (active, service type, day).
- Detail: contact, plan (`service_type`/`preferred_day`/`price_per_visit`/`frequency_weeks`),
  dogs (add/edit/remove), gate code + yard notes, billing snapshot (card on file? balance?),
  recent visits with photo indicator.
- Create/edit client + dogs.
**Acceptance:** create/edit/delete persists; detail shows real dogs + history; no Stripe charging
here (that's Workstream 6, only read card-on-file status).
**Kickoff prompt:**
> You are building **Workstream 3 (Clients/CRM)** of the Scoop N Go HQ ops hub. Read
> `/Users/jettbrown/Desktop/ScoopNGoArizona/OPS_HUB_PLAN.md`, Global Rules, Workstream 3,
> Appendices A to B. Foundation is merged. Build only your "Owns" files. Do not implement charging
> (Workstream 6 owns Stripe), only read `stripe_customer_id` to show "card on file". Verify
> Acceptance, commit to `ws3-clients`.

### Workstream 4, Leads & Quotes

**Goal:** the requests inbox (leads from the website), convert a lead into a client, and a quote
builder with a **public online-approval page** that converts an approved quote into a client + a
recurring plan.

**Owns:**
```
hq/app/(hub)/leads/page.tsx
hq/app/(hub)/quotes/page.tsx
hq/app/(hub)/quotes/[id]/page.tsx
hq/app/quote/[token]/page.tsx          (PUBLIC approval page, outside auth)
hq/app/api/leads/route.ts
hq/app/api/quotes/route.ts
hq/app/api/quotes/[token]/route.ts     (public approve/decline)
hq/components/leads/*
hq/components/quotes/*
```
**Reads/Writes:** `leads` (status updates), `quotes` (CRUD + public approve), `customers` (create on
convert/approve), `dogs`.
**Screens & endpoints:**
- Leads inbox: list `leads`, update status, "convert to client" → creates a `customers` row.
- Quote builder: line items (jsonb), one-time + recurring amounts, send (generates `public_token`).
- Public `/quote/[token]`: client views and approves/declines; approve → create customer + plan.
**Acceptance:** convert-lead creates a customer; quote send produces a shareable token URL; public
approval creates a customer and marks the quote approved. Public page must not require login and
must not expose the service-role key.
**Kickoff prompt:**
> You are building **Workstream 4 (Leads & Quotes)** of the Scoop N Go HQ ops hub. Read
> `/Users/jettbrown/Desktop/ScoopNGoArizona/OPS_HUB_PLAN.md`, Global Rules, Workstream 4,
> Appendices A to B. Foundation is merged. Build only your "Owns" files. The `/quote/[token]` page is
> public (no auth) and must only use safe server endpoints. Verify Acceptance, commit to
> `ws4-leads-quotes`.

### Workstream 5, Field tool (complete a visit)

**Goal:** the mobile, phone-friendly screen used at each stop, mark done, snap/upload a gate photo,
log notes, flag an issue. Wires up the `service_logs` table and `gate_photo_url` (already in schema).

**Owns:**
```
hq/app/field/page.tsx                  (mobile-optimized list of today's stops)
hq/app/field/[appointmentId]/page.tsx  (complete-a-visit form)
hq/app/api/visits/route.ts             (create service_log, upload photo URL)
hq/components/field/*
hq/lib/storage.ts                      (Supabase Storage upload helper, owns this file)
```
**Reads/Writes:** reads `appointments`, `customers`, `dogs`; writes `service_logs`
(`gate_photo_url`, `technician_notes`, `issue_flagged`, `completed_by`), and sets
`appointments.status = completed`. Creates/uses a Supabase Storage bucket `visit-photos`.
**Screens & endpoints:**
- Mobile list of today's stops (large tap targets) → tap a stop → completion form.
- Photo capture/upload to Storage; store URL in `service_logs.gate_photo_url`.
- Mark complete (sets appointment status + writes service_log with `completed_by`).
**Acceptance:** completing a visit on a phone-sized viewport writes a `service_logs` row with a
working photo URL and flips the appointment to completed.
**Kickoff prompt:**
> You are building **Workstream 5 (Field tool)** of the Scoop N Go HQ ops hub. Read
> `/Users/jettbrown/Desktop/ScoopNGoArizona/OPS_HUB_PLAN.md`, Global Rules, Workstream 5,
> Appendices A to B. Foundation is merged. Build only your "Owns" files (you also own
> `hq/lib/storage.ts`). Design mobile-first. Create the `visit-photos` Storage bucket. Verify
> Acceptance on a phone-sized viewport, commit to `ws5-field`.

### Workstream 6, Invoices & payments

**Goal:** invoice list + AR, and the **ported Stripe charging flow** (weekly auto-charge, manual
charge, receipts, failed-payment alerts) moved from the old `/api` functions into the new app. This
is the most sensitive workstream, reuse the existing, tested logic.

**Owns:**
```
hq/app/(hub)/invoices/page.tsx
hq/app/api/invoices/route.ts
hq/app/api/charge/route.ts             (port of /api/charge-customers.js)
hq/app/api/auto-invoice/route.ts       (port of /api/auto-invoice.js, cron)
hq/app/api/stripe/setup/route.ts       (port of card-setup link)
hq/app/api/stripe/webhook/route.ts     (port of /api/stripe-webhook.js)
hq/components/invoices/*
```
**Reads/Writes:** `invoices`, `payments`, `customers.stripe_customer_id`; calls Stripe + Resend.
**Screens & endpoints:**
- Invoice list with status filters; per-client AR; "send card setup link"; "charge now".
- Port the existing charge logic verbatim where possible (it already: skips already-paid weeks,
  updates a sent invoice to paid instead of duplicating, emails receipts, emails failed-payment
  alerts). Keep `CRON_SECRET` protection.
**Acceptance:** a test charge against a Stripe test card creates/updates an invoice to paid and a
payment row; failed charge sends the alert email; behavior matches the current `charge-customers.js`.
**Soft integration:** the customer portal (7) links to the setup route you expose; agree on the
path `/api/stripe/setup` (already specified) so no coordination is needed.
**Kickoff prompt:**
> You are building **Workstream 6 (Invoices & payments)** of the Scoop N Go HQ ops hub. Read
> `/Users/jettbrown/Desktop/ScoopNGoArizona/OPS_HUB_PLAN.md`, Global Rules, Workstream 6,
> Appendices A to B/E. Foundation is merged. Port the existing functions in the repo's root `/api`
> (`charge-customers.js`, `auto-invoice.js`, `stripe-setup.js`, `stripe-webhook.js`) into your
> "Owns" files, preserving their tested behavior. Do not change the root `/api` files. Verify with
> Stripe test mode, commit to `ws6-billing`.

### Workstream 7, Customer portal ("client hub")

**Goal:** the customer-facing self-service page, see next/last visit + photo, pay balance, update
card, skip next visit, refer a friend. Public, separate auth from staff (magic-link via token).

**Owns:**
```
hq/app/my-account/page.tsx             (PUBLIC, token/magic-link auth)
hq/app/my-account/login/page.tsx
hq/app/api/portal/route.ts             (lookup by portal_token / magic link)
hq/app/api/portal/skip/route.ts        (skip next visit)
hq/components/portal/*
```
**Reads/Writes:** reads `customers`, `appointments`, `service_logs`, `invoices`; writes a "skip"
(sets the next `appointment.status = skipped`); uses `customers.portal_token` for access.
**Screens & endpoints:**
- Magic-link / token login → account page.
- Next visit, last visit + photo (from `service_logs`), balance, skip-next-visit, update-card
  (links to Workstream 6's `/api/stripe/setup`), refer-a-friend.
**Acceptance:** a valid `portal_token` loads the right customer's data; skip writes a skipped
appointment; no staff data leaks; service-role key never reaches the browser.
**Kickoff prompt:**
> You are building **Workstream 7 (Customer portal)** of the Scoop N Go HQ ops hub. Read
> `/Users/jettbrown/Desktop/ScoopNGoArizona/OPS_HUB_PLAN.md`, Global Rules, Workstream 7,
> Appendices A to B. Foundation is merged. Build only your "Owns" files. This is a PUBLIC surface,
> authenticate customers by `portal_token`, never expose staff data or the service-role key. For
> "update card", link to `/api/stripe/setup` (Workstream 6). Verify Acceptance, commit to
> `ws7-portal`.

### Workstream 8, Automations & messaging

**Goal:** the automations screen (toggles) and the messaging engine, "on my way" SMS, completion +
photo SMS, appointment reminders, review requests. SMS via Twilio; email via Resend.

**Owns:**
```
hq/app/(hub)/automations/page.tsx
hq/app/api/automations/route.ts        (read/update toggles)
hq/app/api/sms/send/route.ts           (Twilio send + log to notifications)
hq/app/api/automations/run/route.ts    (cron: reminders, review requests)
hq/components/automations/*
hq/lib/twilio.ts                       (owns this file)
```
**Reads/Writes:** `automations` (toggles + config), `notifications` (log every message),
`appointments`, `customers`.
**Screens & endpoints:**
- Automations page: toggle each automation on/off (writes `automations`).
- `sms/send`: send a text via Twilio, log a `notifications` row.
- `automations/run` (cron, `CRON_SECRET`): send due reminders / review requests based on toggles.
**Acceptance:** toggling persists; a test SMS sends in Twilio test mode and logs a `notifications`
row; the cron respects the on/off toggles.
**Soft integration:** Workstreams 2/5 may *call* `/api/sms/send` later (on route start / visit
complete). Expose that endpoint with a stable contract; they wire to it post-merge.
**Kickoff prompt:**
> You are building **Workstream 8 (Automations & messaging)** of the Scoop N Go HQ ops hub. Read
> `/Users/jettbrown/Desktop/ScoopNGoArizona/OPS_HUB_PLAN.md`, Global Rules, Workstream 8,
> Appendices A to B/E. Foundation is merged. Build only your "Owns" files (you also own
> `hq/lib/twilio.ts`). Log every message to `notifications`. Verify with Twilio test mode, commit
> to `ws8-automations`.

---

## Appendix A, Shared TypeScript types (`hq/lib/types.ts`)

These mirror the database. Foundation writes this file; nobody else edits it.

```ts
export type LeadStatus = 'new' | 'contacted' | 'converted' | 'lost';
export type ServiceType = 'Weekly' | 'Bi-Weekly' | 'One-Time';
export type ApptStatus = 'scheduled' | 'completed' | 'skipped' | 'cancelled';
export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue';
export type QuoteStatus = 'draft' | 'sent' | 'approved' | 'declined';
export type TechRole = 'owner' | 'tech';
export type PayMethod = 'cash' | 'venmo' | 'zelle' | 'card' | 'check';

export interface Lead {
  id: string; created_at: string;
  first_name: string; last_name: string; phone: string; email: string;
  zip: string; dogs: string; service_type: string; notes?: string; status: LeadStatus;
}

export interface Customer {
  id: string; created_at: string; lead_id?: string;
  first_name: string; last_name: string; phone: string; email: string;
  address?: string; city?: string; zip?: string;
  gate_code?: string; yard_notes?: string;
  service_type?: ServiceType; preferred_day?: string; price_per_visit?: number;
  active: boolean;
  stripe_customer_id?: string;        // existing
  frequency_weeks?: number;           // new: 1 weekly, 2 bi-weekly
  start_date?: string;                // new
  next_visit_date?: string;           // new (generator)
  portal_token?: string;              // new (customer portal)
}

export interface Dog { id: string; customer_id: string; name: string; breed?: string; notes?: string; }

export interface Appointment {
  id: string; created_at: string; customer_id: string;
  scheduled_at: string; service_type?: string; status: ApptStatus; notes?: string;
  assigned_to?: string;               // new -> technicians.id
  route_position?: number;            // new
}

export interface ServiceLog {
  id: string; created_at: string; appointment_id?: string; customer_id: string;
  completed_at: string; gate_photo_url?: string; technician_notes?: string;
  issue_flagged: boolean; issue_details?: string;
  completed_by?: string;              // new -> technicians.id
}

export interface Invoice {
  id: string; created_at: string; customer_id: string;
  period_start?: string; period_end?: string; amount: number;
  status: InvoiceStatus; due_date?: string; notes?: string;
  stripe_payment_intent_id?: string;  // existing
}

export interface Payment {
  id: string; created_at: string; invoice_id: string;
  amount: number; method?: PayMethod; paid_at: string; notes?: string;
}

export interface Technician {
  id: string; created_at: string; name: string; email?: string; phone?: string;
  role: TechRole; auth_user_id?: string; active: boolean; color?: string;
}

export interface QuoteLineItem { label: string; amount: number; recurring?: boolean; }
export interface Quote {
  id: string; created_at: string; lead_id?: string; customer_id?: string;
  line_items: QuoteLineItem[]; subtotal: number;
  recurring_amount?: number; recurring_interval?: string;
  status: QuoteStatus; public_token: string; approved_at?: string; notes?: string;
}

export interface Notification {
  id: string; created_at: string; customer_id: string;
  type: string; channel: 'sms' | 'email'; message?: string; sent_at: string;
  status?: string; appointment_id?: string;
}

export interface Automation {
  id: string; key: string; label: string; enabled: boolean; config?: Record<string, unknown>;
}
```

---

## Appendix B, Database migration (`hq/supabase/migrations/001_ops_hub.sql`)

Additive only, existing tables and data are preserved. Foundation runs this against Supabase.

```sql
-- New: technicians / crew (forward-compatible; single-user today)
create table if not exists technicians (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz default now(),
  name         text not null,
  email        text,
  phone        text,
  role         text default 'tech',     -- 'owner' | 'tech'
  auth_user_id uuid,                     -- links to auth.users
  active       boolean default true,
  color        text default '#2e7d32'
);

-- Appointments: assignment + route ordering
alter table appointments add column if not exists assigned_to   uuid references technicians(id);
alter table appointments add column if not exists route_position int;

-- Service logs: who completed it
alter table service_logs add column if not exists completed_by uuid references technicians(id);

-- Customers: recurring plan + portal access
alter table customers add column if not exists frequency_weeks int default 1;
alter table customers add column if not exists start_date      date;
alter table customers add column if not exists next_visit_date date;
alter table customers add column if not exists portal_token    text unique;

-- Notifications: delivery status + link to appointment
alter table notifications add column if not exists status         text;
alter table notifications add column if not exists appointment_id uuid references appointments(id);

-- Quotes
create table if not exists quotes (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz default now(),
  lead_id            uuid references leads(id),
  customer_id        uuid references customers(id),
  line_items         jsonb not null default '[]',
  subtotal           numeric(8,2) not null default 0,
  recurring_amount   numeric(8,2),
  recurring_interval text,
  status             text default 'draft',  -- draft|sent|approved|declined
  public_token       text unique not null,
  approved_at        timestamptz,
  notes              text
);

-- Automations toggles
create table if not exists automations (
  id        uuid primary key default gen_random_uuid(),
  key       text unique not null,
  label     text not null,
  enabled   boolean default false,
  config    jsonb default '{}'
);

insert into automations (key, label, enabled) values
  ('on_my_way',      'On-my-way text',            true),
  ('visit_complete', 'Visit-complete photo text', true),
  ('weekly_charge',  'Weekly auto-charge',        true),
  ('review_request', 'Review request',            false),
  ('failed_payment', 'Failed-payment alert',      true)
on conflict (key) do nothing;
```

> Note: `customers.stripe_customer_id` and `invoices.stripe_payment_intent_id` already exist in the
> live database (added outside the original `supabase_schema.sql`). This migration does not redefine
> them.

---

## Appendix C, Brand tokens (for `tailwind.config.ts` / `globals.css`)

From the current `admin.html`:
```
green:       #2e7d32   green-dark: #1b5e20   green-mid:  #388e3c   green-light: #e8f5e9
tan:         #f9f6f1   dark:       #1a1a1a   mid:        #555      border:      #e0e0e0
yellow:      #f9a825   red:        #c62828   blue:       #1565c0   radius:      10px
Headings: Montserrat (700 to 900). Body: Open Sans.
Status badges: new=blue, contacted=yellow, converted/completed=green, lost/cancelled=red,
               scheduled=blue, skipped=purple, draft=gray.
```

---

## Appendix D, Navigation / route map (Foundation builds the shell with all of these)

| Nav label | Route | Workstream | Auth |
|---|---|---|---|
| Dashboard | `/dashboard` | 1 | staff |
| Route | `/route` | 2 | staff |
| Clients | `/clients`, `/clients/[id]` | 3 | staff |
| Leads | `/leads` | 4 | staff |
| Quotes | `/quotes`, `/quotes/[id]` | 4 | staff |
| Invoices | `/invoices` | 6 | staff |
| Automations | `/automations` | 8 | staff |
| Field (mobile) | `/field`, `/field/[appointmentId]` | 5 | staff |
| (public) Quote approval | `/quote/[token]` | 4 | public |
| (public) Customer portal | `/my-account` | 7 | customer token |

---

## Appendix E, Dependencies & env (Foundation installs/declares all of these)

**Dependencies** (so feature agents never edit `package.json`):
```
next react react-dom typescript
@supabase/supabase-js @supabase/ssr
stripe
tailwindcss postcss autoprefixer
clsx date-fns
twilio                 (Workstream 8)
@hello-pangea/dnd      (Workstream 2, drag/drop reorder)
```

**Environment variables** (`.env.example`):
```
SUPABASE_URL=                 # currently hardcoded in old /api functions
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=         # server-only, never client
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
RESEND_API_KEY=
CRON_SECRET=
TWILIO_ACCOUNT_SID=           # Workstream 8
TWILIO_AUTH_TOKEN=            # Workstream 8
TWILIO_FROM_NUMBER=           # Workstream 8
NEXT_PUBLIC_BASE_URL=
```

---

## Cutover (after all workstreams merge, you decide when)

1. Deploy the `/hq` app as its own Vercel project (or `hq.scoopngoarizona.com`).
2. Smoke-test every screen against real data behind login.
3. Move the weekly-charge cron from the old function to the new `/api/auto-invoice` (or keep the old
   one running until parity is confirmed, they can coexist; both hit the same Supabase).
4. Repoint `/admin` to the new app and retire `admin.html`. The public marketing site is unchanged.
```
