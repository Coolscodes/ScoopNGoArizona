// Workstream 8, Automations toggles API.
//
// JSON contract
// =============
// GET  /api/automations
//   -> 200 { automations: Automation[] }   (ordered by key)
//   -> 500 { error }
//
// PATCH /api/automations
//   body: { key?: string, id?: string, enabled: boolean }   // identify by key OR id
//   -> 200 { ok: true, automation: Automation }
//   -> 400 on a malformed body (missing key/id or non-boolean enabled)
//   -> 404 if no row matches
//   -> 500 on a database error

import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import type { Automation } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const sb = supabaseServer();
    const { data, error } = await sb
      .from('automations')
      .select('*')
      .order('key', { ascending: true });
    if (error) throw error;
    return NextResponse.json({ automations: (data ?? []) as Automation[] });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load automations';
    return NextResponse.json({ error: message, automations: [] }, { status: 500 });
  }
}

interface PatchBody {
  key?: unknown;
  id?: unknown;
  enabled?: unknown;
}

export async function PATCH(request: Request) {
  let parsed: PatchBody;
  try {
    parsed = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const key = typeof parsed.key === 'string' && parsed.key ? parsed.key : undefined;
  const id = typeof parsed.id === 'string' && parsed.id ? parsed.id : undefined;
  const enabled = parsed.enabled;

  if (typeof enabled !== 'boolean') {
    return NextResponse.json(
      { error: 'enabled (boolean) is required' },
      { status: 400 }
    );
  }
  if (!key && !id) {
    return NextResponse.json(
      { error: 'Provide a key or id to identify the automation' },
      { status: 400 }
    );
  }

  try {
    const sb = supabaseServer();
    let query = sb.from('automations').update({ enabled });
    query = id ? query.eq('id', id) : query.eq('key', key as string);

    const { data, error } = await query.select('*').maybeSingle();
    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: 'Automation not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, automation: data as Automation });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update automation';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
