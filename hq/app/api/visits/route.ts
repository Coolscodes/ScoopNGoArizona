// Workstream 5 — Field tool: complete a visit.
//
// JSON / multipart contract
// =========================
// POST /api/visits
//   Accepts EITHER application/json OR multipart/form-data.
//
//   JSON body:
//     {
//       appointmentId?: string,     // appointment to complete (sets status='completed')
//       customer_id: string,        // required
//       notes?: string,             // -> service_logs.technician_notes
//       issue_flagged?: boolean,
//       issue_details?: string,
//       photo?: string              // base64 data URL ("data:image/jpeg;base64,...")
//     }
//
//   FormData fields:
//     appointmentId, customer_id, notes, issue_flagged ('true'|'false'),
//     issue_details, photo (a File)
//
//   On success -> 201 {
//     ok: true,
//     service_log: ServiceLog,
//     appointment_id: string | null,
//     photo_url: string | null
//   }
//   400 on a malformed body / missing customer_id, 500 on a DB / storage error.
//
// Side effects:
//   1. Uploads the photo (if any) to the public `visit-photos` Storage bucket.
//   2. Inserts a service_logs row (customer_id, appointment_id, completed_at=now,
//      gate_photo_url, technician_notes, issue_flagged, issue_details, completed_by).
//   3. Sets the appointment status='completed' (when appointmentId is provided).

import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getCurrentTechnician } from '@/lib/auth';
import { uploadVisitPhoto, decodeDataUrl } from '@/lib/storage';
import type { ServiceLog } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface VisitInput {
  appointmentId: string | null;
  customer_id: string;
  notes: string | null;
  issue_flagged: boolean;
  issue_details: string | null;
  photoDataUrl: string | null;
  photoFile: File | null;
}

function asBool(v: unknown): boolean {
  return v === true || v === 'true' || v === 'on' || v === '1';
}

function cleanStr(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length ? t : null;
}

async function parseInput(request: Request): Promise<VisitInput> {
  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    const photo = form.get('photo');
    return {
      appointmentId: cleanStr(form.get('appointmentId')),
      customer_id: cleanStr(form.get('customer_id')) ?? '',
      notes: cleanStr(form.get('notes')),
      issue_flagged: asBool(form.get('issue_flagged')),
      issue_details: cleanStr(form.get('issue_details')),
      photoDataUrl: null,
      photoFile: photo instanceof File && photo.size > 0 ? photo : null,
    };
  }

  const body = (await request.json()) as Record<string, unknown>;
  const photo = cleanStr(body.photo);
  return {
    appointmentId: cleanStr(body.appointmentId),
    customer_id: cleanStr(body.customer_id) ?? '',
    notes: cleanStr(body.notes),
    issue_flagged: asBool(body.issue_flagged),
    issue_details: cleanStr(body.issue_details),
    photoDataUrl: photo && photo.startsWith('data:') ? photo : null,
    photoFile: null,
  };
}

export async function POST(request: Request) {
  let input: VisitInput;
  try {
    input = await parseInput(request);
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!input.customer_id) {
    return NextResponse.json({ error: 'customer_id is required' }, { status: 400 });
  }

  try {
    // Resolve the technician completing the visit (null is fine — single-user today).
    const tech = await getCurrentTechnician();

    // 1) Upload the photo, if one was provided.
    let photoUrl: string | null = null;
    if (input.photoFile) {
      const buffer = Buffer.from(await input.photoFile.arrayBuffer());
      photoUrl = await uploadVisitPhoto(buffer, {
        mime: input.photoFile.type || 'image/jpeg',
        pathPrefix: input.customer_id,
      });
    } else if (input.photoDataUrl) {
      const { buffer, mime } = decodeDataUrl(input.photoDataUrl);
      photoUrl = await uploadVisitPhoto(buffer, {
        mime,
        pathPrefix: input.customer_id,
      });
    }

    const sb = supabaseServer();

    // 2) Write the service_logs row.
    const logRow = {
      customer_id: input.customer_id,
      appointment_id: input.appointmentId,
      completed_at: new Date().toISOString(),
      gate_photo_url: photoUrl,
      technician_notes: input.notes,
      issue_flagged: input.issue_flagged,
      issue_details: input.issue_flagged ? input.issue_details : null,
      completed_by: tech?.id ?? null,
    };

    const { data: serviceLog, error: logError } = await sb
      .from('service_logs')
      .insert(logRow)
      .select('*')
      .single();
    if (logError) throw logError;

    // 3) Flip the appointment to completed (if one was specified).
    if (input.appointmentId) {
      const { error: apptError } = await sb
        .from('appointments')
        .update({ status: 'completed' })
        .eq('id', input.appointmentId);
      if (apptError) throw apptError;
    }

    return NextResponse.json(
      {
        ok: true,
        service_log: serviceLog as ServiceLog,
        appointment_id: input.appointmentId,
        photo_url: photoUrl,
      },
      { status: 201 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to complete the visit';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
