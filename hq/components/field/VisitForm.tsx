'use client';

// Workstream 5, Complete-a-visit form (mobile-first client component).
// Notes textarea, an "issue flagged" toggle + details, and a gate photo capture.
// On submit, sends a base64 data URL (+ fields) to /api/visits as JSON.

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, FormField, Textarea, useToast } from '@/components/ui';

export interface VisitFormProps {
  appointmentId: string;
  customerId: string;
  customerName: string;
  alreadyCompleted: boolean;
  autoCharge: boolean;
}

// Charge outcome returned by POST /api/visits (charge-on-completion).
interface ChargeOutcome {
  attempted: boolean;
  reason?: string;
  result?:
    | { name: string; status: 'charged'; amount: number }
    | { name: string; status: 'skipped' | 'failed'; reason: string };
}

// Read a File as a base64 data URL.
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

export function VisitForm({
  appointmentId,
  customerId,
  customerName,
  alreadyCompleted,
  autoCharge,
}: VisitFormProps) {
  const router = useRouter();
  const toast = useToast();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [notes, setNotes] = useState('');
  const [issueFlagged, setIssueFlagged] = useState(false);
  const [issueDetails, setIssueDetails] = useState('');
  const [noCharge, setNoCharge] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  function onPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setPhotoFile(file);
    setPhotoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file ? URL.createObjectURL(file) : null;
    });
  }

  function clearPhoto() {
    setPhotoFile(null);
    setPhotoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function submit() {
    if (issueFlagged && !issueDetails.trim()) {
      toast('Add a few words about the issue', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const photo = photoFile ? await fileToDataUrl(photoFile) : null;
      const res = await fetch('/api/visits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointmentId,
          customer_id: customerId,
          notes: notes.trim() || null,
          issue_flagged: issueFlagged,
          issue_details: issueFlagged ? issueDetails.trim() : null,
          no_charge: noCharge,
          photo,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || 'Request failed');
      }
      const data = (await res.json().catch(() => ({}))) as { charge?: ChargeOutcome | null };
      setDone(true);
      const charge = data.charge ?? null;
      if (charge?.attempted && charge.result) {
        const r = charge.result;
        if (r.status === 'charged') toast(`Visit completed, charged $${r.amount.toFixed(2)}`);
        else if (r.status === 'failed') toast(`Visit saved, but card charge failed: ${r.reason}`, 'error');
        else toast(`Visit completed, charge skipped: ${r.reason}`);
      } else {
        toast('Visit completed');
      }
      // Refresh server data, then return to the stop list.
      router.refresh();
      setTimeout(() => router.push('/field'), 700);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save the visit';
      toast(message, 'error');
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="bg-white rounded-card border border-line p-6 text-center">
        <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-brand-light text-brand-dark flex items-center justify-center">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden>
            <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <p className="font-heading font-bold text-ink">Visit logged for {customerName}</p>
        <p className="text-sm text-muted mt-1">Heading back to your stops…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {alreadyCompleted && (
        <div className="bg-brand-light text-brand-dark text-sm rounded-card px-4 py-3 font-semibold">
          This stop is already marked completed. Submitting again logs another visit.
        </div>
      )}

      {/* Photo capture */}
      <div className="bg-white rounded-card border border-line p-4">
        <span className="block text-[0.8rem] font-heading font-bold text-muted mb-2">
          Gate / yard photo
        </span>

        {photoPreview ? (
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photoPreview}
              alt="Selected gate photo"
              className="w-full rounded-card border border-line object-cover max-h-72"
            />
            <button
              type="button"
              onClick={clearPhoto}
              className="absolute top-2 right-2 bg-black/60 text-white rounded-full w-8 h-8 flex items-center justify-center text-lg leading-none"
              aria-label="Remove photo"
            >
              ×
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full border-2 border-dashed border-line rounded-card py-8 px-4 flex flex-col items-center gap-2 text-muted active:bg-tan transition-colors"
          >
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <path d="M3 8a2 2 0 0 1 2-2h2l1.2-1.6A1 1 0 0 1 11 4h2a1 1 0 0 1 .8.4L15 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Z" strokeLinejoin="round" />
              <circle cx="12" cy="12.5" r="3.2" />
            </svg>
            <span className="font-heading font-bold text-sm">Take or upload a photo</span>
          </button>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onPhotoChange}
          className="hidden"
        />
      </div>

      {/* Notes */}
      <div className="bg-white rounded-card border border-line p-4">
        <FormField label="Visit notes">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything worth recording about this visit…"
            className="min-h-[96px] text-base"
          />
        </FormField>

        {/* Issue toggle */}
        <label className="flex items-center gap-3 cursor-pointer select-none mt-1">
          <input
            type="checkbox"
            checked={issueFlagged}
            onChange={(e) => setIssueFlagged(e.target.checked)}
            className="w-5 h-5 accent-[#c62828]"
          />
          <span className="font-heading font-bold text-sm text-ink">Flag an issue</span>
        </label>

        {issueFlagged && (
          <div className="mt-3">
            <Textarea
              value={issueDetails}
              onChange={(e) => setIssueDetails(e.target.value)}
              placeholder="What's the issue? (locked gate, aggressive dog, hazard…)"
              className="min-h-[80px] text-base border-danger/40"
            />
          </div>
        )}

        {autoCharge && (
          <label className="flex items-start gap-3 cursor-pointer select-none mt-3">
            <input
              type="checkbox"
              checked={noCharge}
              onChange={(e) => setNoCharge(e.target.checked)}
              className="w-5 h-5 accent-brand mt-0.5"
            />
            <span>
              <span className="font-heading font-bold text-sm text-ink block">
                Paid another way, skip card charge
              </span>
              <span className="text-xs text-muted">
                This client is on auto-charge. Completing the visit bills their card unless you check this.
              </span>
            </span>
          </label>
        )}
      </div>

      {/* Submit, single accent action */}
      <Button
        variant="primary"
        onClick={submit}
        disabled={submitting}
        className="w-full py-4 text-base"
      >
        {submitting
          ? 'Saving…'
          : autoCharge && !noCharge
            ? 'Complete visit + charge card'
            : 'Complete visit'}
      </Button>
    </div>
  );
}
