// Auth helpers. Owned by Workstream 0 — do not edit in Workstreams 1-8.
//
// Uses a cookie-bound SSR client (anon key) purely to read the current staff
// session. Data access still goes through supabaseServer() (service role).

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseServer } from './supabase';
import type { Technician } from './types';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export async function getSessionClient() {
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Called from a Server Component — middleware refreshes the session instead.
        }
      },
    },
  });
}

export async function getCurrentUser() {
  const supabase = await getSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

// Resolve the technicians row for the logged-in auth user (role, name, etc.).
export async function getCurrentTechnician(): Promise<Technician | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const { data } = await supabaseServer()
    .from('technicians')
    .select('*')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  return (data as Technician) ?? null;
}
