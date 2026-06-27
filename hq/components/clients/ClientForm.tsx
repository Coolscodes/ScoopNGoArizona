'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Drawer, FormField, Input, Textarea, Select, useToast } from '@/components/ui';
import type { Customer } from '@/lib/types';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SERVICE_TYPES = ['Weekly', 'Bi-Weekly', 'One-Time'];

type Draft = Partial<Customer>;

// Reusable create/edit form. Pass `client` to edit; omit to create.
export function ClientForm({
  client,
  trigger,
}: {
  client?: Customer;
  trigger?: 'primary' | 'outline';
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft>(client ?? { active: true, frequency_weeks: 1 });

  const isEdit = Boolean(client);

  function set<K extends keyof Customer>(key: K, value: Customer[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function save() {
    if (!draft.first_name?.trim()) {
      toast('First name is required', 'error');
      return;
    }
    setSaving(true);
    const url = isEdit ? `/api/clients/${client!.id}` : '/api/clients';
    const res = await fetch(url, {
      method: isEdit ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    setSaving(false);
    if (!res.ok) {
      toast('Could not save client', 'error');
      return;
    }
    toast(isEdit ? 'Client updated' : 'Client added');
    setOpen(false);
    if (!isEdit) setDraft({ active: true, frequency_weeks: 1 });
    router.refresh();
  }

  return (
    <>
      <Button variant={trigger ?? (isEdit ? 'outline' : 'primary')} onClick={() => setOpen(true)}>
        {isEdit ? 'Edit' : 'New client'}
      </Button>
      <Drawer open={open} onClose={() => setOpen(false)} title={isEdit ? 'Edit client' : 'New client'}>
        <div className="grid grid-cols-2 gap-x-3">
          <FormField label="First name">
            <Input value={draft.first_name ?? ''} onChange={(e) => set('first_name', e.target.value)} />
          </FormField>
          <FormField label="Last name">
            <Input value={draft.last_name ?? ''} onChange={(e) => set('last_name', e.target.value)} />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-x-3">
          <FormField label="Phone">
            <Input value={draft.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
          </FormField>
          <FormField label="Email">
            <Input value={draft.email ?? ''} onChange={(e) => set('email', e.target.value)} />
          </FormField>
        </div>
        <FormField label="Address">
          <Input value={draft.address ?? ''} onChange={(e) => set('address', e.target.value)} />
        </FormField>
        <div className="grid grid-cols-2 gap-x-3">
          <FormField label="City">
            <Input value={draft.city ?? ''} onChange={(e) => set('city', e.target.value)} />
          </FormField>
          <FormField label="ZIP">
            <Input value={draft.zip ?? ''} onChange={(e) => set('zip', e.target.value)} />
          </FormField>
        </div>
        <FormField label="Gate code">
          <Input value={draft.gate_code ?? ''} onChange={(e) => set('gate_code', e.target.value)} />
        </FormField>
        <FormField label="Yard notes / access">
          <Textarea value={draft.yard_notes ?? ''} onChange={(e) => set('yard_notes', e.target.value)} />
        </FormField>
        <div className="grid grid-cols-2 gap-x-3">
          <FormField label="Service type">
            <Select
              value={draft.service_type ?? ''}
              onChange={(e) => set('service_type', e.target.value as Customer['service_type'])}
            >
              <option value="">—</option>
              {SERVICE_TYPES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          </FormField>
          <FormField label="Preferred day">
            <Select value={draft.preferred_day ?? ''} onChange={(e) => set('preferred_day', e.target.value)}>
              <option value="">—</option>
              {DAYS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </Select>
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-x-3">
          <FormField label="Price per visit ($)">
            <Input
              type="number"
              step="0.01"
              value={draft.price_per_visit ?? ''}
              onChange={(e) => set('price_per_visit', e.target.value === '' ? undefined : Number(e.target.value))}
            />
          </FormField>
          <FormField label="Every N weeks">
            <Input
              type="number"
              step="1"
              min="1"
              value={draft.frequency_weeks ?? 1}
              onChange={(e) => set('frequency_weeks', Number(e.target.value))}
            />
          </FormField>
        </div>
        <label className="flex items-center gap-2 mb-4 text-sm">
          <input
            type="checkbox"
            checked={draft.active ?? true}
            onChange={(e) => set('active', e.target.checked)}
          />
          Active
        </label>
        <div className="flex gap-2">
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add client'}
          </Button>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      </Drawer>
    </>
  );
}
