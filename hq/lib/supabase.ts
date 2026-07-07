// Supabase clients. Owned by Workstream 0, do not edit in Workstreams 1-8.
//
//   supabaseBrowser()  -> anon client for client components (auth UI).
//   supabaseServer()   -> service-role client for server data access (server-only).
//
// The service-role key bypasses RLS, so supabaseServer() must ONLY be called from
// server components, route handlers, and server actions. Access control for staff
// routes is enforced by middleware + the (hub) layout auth guard.

import { createBrowserClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

export function supabaseBrowser(): SupabaseClient {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

let _admin: SupabaseClient | null = null;

export function supabaseServer(): SupabaseClient {
  if (typeof window !== 'undefined') {
    throw new Error('supabaseServer() is server-only and must not run in the browser.');
  }
  if (_admin) return _admin;
  _admin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || '', {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _admin;
}
