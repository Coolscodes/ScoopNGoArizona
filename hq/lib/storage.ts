// Workstream 5 — Supabase Storage helper (server-only).
//
// Owns the public `visit-photos` bucket used by the field tool. Ensures the
// bucket exists (creating it via the service role if missing), uploads a
// file/buffer, and returns its public URL.
//
// SERVER-ONLY: relies on supabaseServer() (service-role key). Never import this
// into a client component.

import { supabaseServer } from './supabase';

export const VISIT_PHOTOS_BUCKET = 'visit-photos';

let _bucketReady = false;

// Idempotently ensure the public bucket exists. Cached for the lifetime of the
// server process so we don't round-trip on every upload.
async function ensureBucket(): Promise<void> {
  if (_bucketReady) return;
  const sb = supabaseServer();

  const { data: bucket } = await sb.storage.getBucket(VISIT_PHOTOS_BUCKET);
  if (bucket) {
    _bucketReady = true;
    return;
  }

  const { error } = await sb.storage.createBucket(VISIT_PHOTOS_BUCKET, {
    public: true,
    fileSizeLimit: '15MB',
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
  });

  // Tolerate a race where another request created it first.
  if (error && !/already exists/i.test(error.message)) {
    throw error;
  }
  _bucketReady = true;
}

function extForMime(mime: string): string {
  switch (mime) {
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/heic':
      return 'heic';
    case 'image/heif':
      return 'heif';
    default:
      return 'jpg';
  }
}

// Decode a `data:<mime>;base64,<data>` URL into a Buffer + mime type.
export function decodeDataUrl(dataUrl: string): { buffer: Buffer; mime: string } {
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(dataUrl);
  if (!match) throw new Error('Invalid data URL');
  const mime = match[1] || 'image/jpeg';
  const isBase64 = !!match[2];
  const raw = match[3] ?? '';
  const buffer = isBase64
    ? Buffer.from(raw, 'base64')
    : Buffer.from(decodeURIComponent(raw), 'utf8');
  return { buffer, mime };
}

// Upload a buffer (or File/Blob) to the visit-photos bucket and return its
// public URL. `pathPrefix` groups files (e.g. a customer id).
export async function uploadVisitPhoto(
  data: Buffer | Blob,
  options: { mime?: string; pathPrefix?: string } = {}
): Promise<string> {
  await ensureBucket();
  const sb = supabaseServer();

  const mime =
    options.mime ||
    (data instanceof Blob && data.type ? data.type : 'image/jpeg');
  const ext = extForMime(mime);
  const prefix = options.pathPrefix ? `${options.pathPrefix}/` : '';
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const path = `${prefix}${unique}.${ext}`;

  const { error } = await sb.storage.from(VISIT_PHOTOS_BUCKET).upload(path, data, {
    contentType: mime,
    upsert: false,
  });
  if (error) throw error;

  const { data: pub } = sb.storage.from(VISIT_PHOTOS_BUCKET).getPublicUrl(path);
  return pub.publicUrl;
}
