-- ============================================================
-- Scoop N Go HQ — migration 002: standing route order + admin flags
-- Run in: Supabase > SQL Editor > New Query
-- Additive only.
-- ============================================================

-- Standing position within a client's day-of-week route. When you reorder a
-- day's route, this is saved per client so every future route for that day
-- inherits the order (the visit generator copies it onto new appointments).
alter table customers add column if not exists route_order int;

-- Admin flags shown on the client + on the route (e.g. 'dog aggressive',
-- 'gate code changed', 'cash customer', 'upsell deodorizer',
-- 'do not service if raining').
alter table customers add column if not exists flags text[] default '{}';
