// Workstream 3 — Dogs API (nested under a client).
//   POST   /api/clients/:id/dogs  { name, breed?, notes? }            -> 201 { dog }
//   PATCH  /api/clients/:id/dogs  { dog_id, name?, breed?, notes? }   -> 200 { dog }
//   DELETE /api/clients/:id/dogs?dog_id=...                           -> 200 { ok }

import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import type { Dog } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (typeof body.name !== 'string' || !body.name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  try {
    const { data, error } = await supabaseServer()
      .from('dogs')
      .insert({
        customer_id: params.id,
        name: body.name,
        breed: body.breed || null,
        notes: body.notes || null,
      })
      .select('*')
      .single();
    if (error) throw error;
    return NextResponse.json({ dog: data as Dog }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to add dog';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (typeof body.dog_id !== 'string') {
    return NextResponse.json({ error: 'dog_id is required' }, { status: 400 });
  }
  const update: Partial<Dog> = {};
  if (body.name !== undefined) update.name = String(body.name);
  if (body.breed !== undefined) update.breed = (body.breed as string) || undefined;
  if (body.notes !== undefined) update.notes = (body.notes as string) || undefined;
  try {
    const { data, error } = await supabaseServer()
      .from('dogs')
      .update(update)
      .eq('id', body.dog_id)
      .eq('customer_id', params.id)
      .select('*')
      .single();
    if (error) throw error;
    return NextResponse.json({ dog: data as Dog });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update dog';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const { searchParams } = new URL(request.url);
  const dogId = searchParams.get('dog_id');
  if (!dogId) {
    return NextResponse.json({ error: 'dog_id is required' }, { status: 400 });
  }
  try {
    const { error } = await supabaseServer()
      .from('dogs')
      .delete()
      .eq('id', dogId)
      .eq('customer_id', params.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to remove dog';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
