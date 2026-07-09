-- Migration 003: charge-on-completion opt-in.
-- Adds customers.auto_charge: when true, marking a visit done (route page,
-- dashboard, or field tool) charges the client's card on file for their
-- price_per_visit, unless the operator picks "Done, no charge".
-- Code degrades gracefully if this hasn't run (treated as false).

alter table customers
  add column if not exists auto_charge boolean not null default false;

comment on column customers.auto_charge is
  'Charge card on file automatically when a visit is marked completed.';
