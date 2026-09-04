-- Migration 005: last name and email become optional on customers.
-- Run in: Supabase > SQL Editor > New Query
--
-- Why: customers.last_name, phone and email were all NOT NULL, inherited from the
-- marketing site signup form where every field was collected at once. Adding a
-- client by hand in HQ often means a first name and a phone number and nothing
-- else, and the blank fields were failing the insert at the database with
-- "violates not-null constraint" behind a generic "Could not save client".
--
-- Phone stays required: it is how a client actually gets contacted.

alter table customers alter column last_name drop not null;
alter table customers alter column email     drop not null;
