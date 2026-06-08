-- ============================================================
-- Scoop N Go Arizona — Supabase Schema
-- Paste this entire file into: Supabase > SQL Editor > New Query
-- ============================================================


-- 1. LEADS — quote form submissions from the website
-- ============================================================
create table leads (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz default now(),
  first_name   text not null,
  last_name    text not null,
  phone        text not null,
  email        text not null,
  zip          text not null,
  dogs         text not null,
  service_type text not null,  -- 'Weekly' | 'Bi-Weekly' | 'One-Time Cleanup'
  notes        text,
  status       text default 'new'  -- 'new' | 'contacted' | 'converted' | 'lost'
);

-- Allow the website form to insert without login
alter table leads enable row level security;
create policy "Anyone can submit a lead" on leads
  for insert with check (true);


-- 2. CUSTOMERS — active paying customers (converted from leads)
-- ============================================================
create table customers (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz default now(),
  lead_id         uuid references leads(id),
  first_name      text not null,
  last_name       text not null,
  phone           text not null,
  email           text not null,
  address         text,
  city            text,
  zip             text,
  gate_code       text,
  yard_notes      text,          -- access info, hazards, special instructions
  service_type    text,          -- 'Weekly' | 'Bi-Weekly' | 'One-Time'
  preferred_day   text,          -- 'Monday' ... 'Saturday'
  price_per_visit numeric(6,2),
  active          boolean default true
);


-- 3. DOGS — one or more dogs per customer
-- ============================================================
create table dogs (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  name        text not null,
  breed       text,
  notes       text  -- 'friendly', 'keep inside during visit', etc.
);


-- 4. APPOINTMENTS — scheduled service visits
-- ============================================================
create table appointments (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz default now(),
  customer_id   uuid not null references customers(id) on delete cascade,
  scheduled_at  date not null,
  service_type  text,
  status        text default 'scheduled',  -- 'scheduled' | 'completed' | 'skipped' | 'cancelled'
  notes         text
);


-- 5. SERVICE LOGS — record of each completed visit
-- ============================================================
create table service_logs (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz default now(),
  appointment_id   uuid references appointments(id),
  customer_id      uuid not null references customers(id) on delete cascade,
  completed_at     timestamptz default now(),
  gate_photo_url   text,   -- upload gate photo to Supabase Storage, store URL here
  technician_notes text,
  issue_flagged    boolean default false,
  issue_details    text
);


-- 6. INVOICES — billing records per customer
-- ============================================================
create table invoices (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz default now(),
  customer_id  uuid not null references customers(id) on delete cascade,
  period_start date,
  period_end   date,
  amount       numeric(8,2) not null,
  status       text default 'draft',  -- 'draft' | 'sent' | 'paid' | 'overdue'
  due_date     date,
  notes        text
);


-- 7. PAYMENTS — payments received against invoices
-- ============================================================
create table payments (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  amount     numeric(8,2) not null,
  method     text,  -- 'cash' | 'venmo' | 'zelle' | 'card' | 'check'
  paid_at    timestamptz default now(),
  notes      text
);


-- 8. NOTIFICATIONS — log of texts/emails sent to customers
-- ============================================================
create table notifications (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz default now(),
  customer_id uuid not null references customers(id) on delete cascade,
  type        text,  -- 'on_the_way' | 'completed' | 'invoice' | 'reminder'
  channel     text,  -- 'sms' | 'email'
  message     text,
  sent_at     timestamptz default now()
);


-- ============================================================
-- USEFUL VIEWS (optional but handy in the Table Editor)
-- ============================================================

-- New leads waiting to be contacted
create view new_leads as
  select * from leads where status = 'new' order by created_at desc;

-- Upcoming appointments this week
create view upcoming_appointments as
  select
    a.scheduled_at,
    c.first_name || ' ' || c.last_name as customer,
    c.address,
    c.phone,
    c.gate_code,
    a.service_type,
    a.status
  from appointments a
  join customers c on c.id = a.customer_id
  where a.scheduled_at >= current_date
    and a.scheduled_at <= current_date + interval '7 days'
    and a.status = 'scheduled'
  order by a.scheduled_at;

-- Unpaid invoices
create view unpaid_invoices as
  select
    i.id,
    c.first_name || ' ' || c.last_name as customer,
    c.phone,
    i.amount,
    i.due_date,
    i.status
  from invoices i
  join customers c on c.id = i.customer_id
  where i.status in ('sent', 'overdue')
  order by i.due_date;
