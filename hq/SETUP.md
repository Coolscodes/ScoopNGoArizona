# Scoop N Go HQ — Foundation setup

This is **Workstream 0** of `OPS_HUB_PLAN.md`. Get it running once, then dispatch the
parallel workstreams.

## 1. Install

```bash
cd hq
npm install
```

## 2. Environment

```bash
cp .env.example .env.local
```

Fill in `.env.local`:

- `NEXT_PUBLIC_SUPABASE_URL` — already set to the project URL.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase > Project Settings > API > anon public key.
- `SUPABASE_SERVICE_KEY` — Supabase > Project Settings > API > service_role key (server-only).
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `CRON_SECRET` — same values
  your existing Vercel functions use.
- Twilio keys can stay blank until Workstream 8.

## 3. Database migration

Run `supabase/migrations/001_ops_hub.sql` in Supabase > SQL Editor. It is additive — existing
tables and data are untouched.

## 4. Create your staff login + owner technician

1. Supabase > Authentication > Users > Add user — your email + a password.
2. Copy the new user's UUID and run in the SQL editor:

   ```sql
   insert into technicians (name, email, role, auth_user_id, active)
   values ('Jett', 'scoopngoarizona@gmail.com', 'owner', '<AUTH_USER_UUID>', true);
   ```

## 5. Run

```bash
npm run dev
```

Open http://localhost:3000 → redirected to `/login` → sign in → the Foundation landing page
with the full nav. The feature tabs (Dashboard, Route, …) 404 until their workstream is built —
that's expected.

## 6. Dispatch the workstreams

Open a new agent tab per workstream and paste its kickoff prompt from `OPS_HUB_PLAN.md`
(sections for Workstreams 1–8). They can all run at the same time.
