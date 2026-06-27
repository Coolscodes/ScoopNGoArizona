'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, useToast } from '@/components/ui';
import type { Dog } from '@/lib/types';

export function DogsEditor({ clientId, dogs }: { clientId: string; dogs: Dog[] }) {
  const router = useRouter();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [breed, setBreed] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  async function addDog() {
    if (!name.trim()) {
      toast('Dog name is required', 'error');
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/clients/${clientId}/dogs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, breed, notes }),
    });
    setBusy(false);
    if (!res.ok) {
      toast('Could not add dog', 'error');
      return;
    }
    toast('Dog added');
    setName(''); setBreed(''); setNotes(''); setAdding(false);
    router.refresh();
  }

  async function removeDog(dogId: string) {
    const res = await fetch(`/api/clients/${clientId}/dogs?dog_id=${dogId}`, { method: 'DELETE' });
    if (!res.ok) {
      toast('Could not remove dog', 'error');
      return;
    }
    toast('Dog removed');
    router.refresh();
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        {dogs.length === 0 && <span className="text-sm text-muted">No dogs on file.</span>}
        {dogs.map((d) => (
          <span
            key={d.id}
            className="inline-flex items-center gap-2 bg-tan border border-line rounded-full pl-3 pr-2 py-1 text-sm"
          >
            <span className="font-heading font-bold">{d.name}</span>
            {(d.breed || d.notes) && (
              <span className="text-muted text-xs">{[d.breed, d.notes].filter(Boolean).join(' · ')}</span>
            )}
            <button
              onClick={() => removeDog(d.id)}
              aria-label={`Remove ${d.name}`}
              className="text-muted hover:text-danger leading-none text-base"
            >
              ×
            </button>
          </span>
        ))}
      </div>

      {adding ? (
        <div className="bg-tan border border-line rounded-card p-3 flex flex-wrap items-end gap-2">
          <div>
            <span className="block text-[0.72rem] font-heading font-bold text-muted mb-1">Name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="w-32 py-1.5" />
          </div>
          <div>
            <span className="block text-[0.72rem] font-heading font-bold text-muted mb-1">Breed</span>
            <Input value={breed} onChange={(e) => setBreed(e.target.value)} className="w-32 py-1.5" />
          </div>
          <div className="flex-1 min-w-[8rem]">
            <span className="block text-[0.72rem] font-heading font-bold text-muted mb-1">Notes</span>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="py-1.5" />
          </div>
          <Button variant="primary" size="sm" onClick={addDog} disabled={busy}>
            {busy ? 'Adding…' : 'Add'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAdding(false)}>Cancel</Button>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setAdding(true)}>+ Add dog</Button>
      )}
    </div>
  );
}
