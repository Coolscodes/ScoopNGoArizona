-- ============================================================
-- Scoop N Go HQ — Ops Hub migration 001 (additive only)
-- Run in: Supabase > SQL Editor > New Query
-- Existing tables and data are preserved.
-- ============================================================

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
alter table appointments add column if not exists assigned_to    uuid references technicians(id);
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

-- ============================================================
-- Security: enable RLS on every table.
-- The app + your existing /api functions read/write with the SERVICE-ROLE
-- key (server-side), which BYPASSES RLS — so nothing breaks. With RLS on and
-- no anon policies, the public anon key (shipped in the browser for login)
-- is denied all access to business data. This is the recommended posture.
-- ============================================================
alter table customers      enable row level security;
alter table dogs           enable row level security;
alter table appointments   enable row level security;
alter table service_logs   enable row level security;
alter table invoices       enable row level security;
alter table payments       enable row level security;
alter table notifications  enable row level security;
alter table technicians    enable row level security;
alter table quotes         enable row level security;
alter table automations    enable row level security;
-- leads already has RLS enabled with a public insert policy (website form) — left as-is.

-- ============================================================
-- After running this, seed yourself as the owner technician.
-- 1) Create a staff login: Supabase > Authentication > Add user (your email + password).
-- 2) Copy that user's UUID, then run (replace both values):
--
--   insert into technicians (name, email, role, auth_user_id, active)
--   values ('Jett', 'scoopngoarizona@gmail.com', 'owner', '<AUTH_USER_UUID>', true);
-- ============================================================
