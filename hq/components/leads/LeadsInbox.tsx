'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Table,
  Th,
  Td,
  StatusPill,
  Button,
  Select,
  Input,
  EmptyState,
  Avatar,
} from '@/components/ui';
import { phone as fmtPhone, fullName, initials, shortDate } from '@/lib/format';
import { leadReplyText, smsLink } from '@/lib/lead-reply';
import type { Lead, LeadStatus } from '@/lib/types';

const STATUS_OPTIONS: LeadStatus[] = ['new', 'contacted', 'converted', 'lost'];
const FILTERS: Array<{ key: LeadStatus | 'all'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'converted', label: 'Converted' },
  { key: 'lost', label: 'Lost' },
];

// The leads table has no city column, so the Meta poller stashes the answer in
// notes as "City answer: Chandler | meta:123". Pull it back out so the reply can
// name their city; leadReplyText falls back to the zip when it is missing.
function cityFromNotes(notes?: string): string {
  const m = (notes ?? '').match(/City answer:\s*([^|]+)/i);
  return m ? m[1].trim() : '';
}

// Opens Messages with the confirmation text already written, so it goes out from
// Jett's own number rather than some unfamiliar business line.
function textLink(l: Lead): string {
  return smsLink(
    l.phone,
    leadReplyText({
      firstName: l.first_name,
      city: cityFromNotes(l.notes),
      zip: l.zip,
      dogs: l.dogs,
      frequency: l.service_type,
      createdAt: l.created_at,
    })
  );
}

const TEXT_LINK_CLASS =
  'inline-flex items-center justify-center gap-1.5 rounded-[7px] font-heading font-bold ' +
  'transition-colors touch-manipulation bg-transparent text-muted border-2 border-line ' +
  'hover:border-brand hover:text-brand px-3 py-1.5 text-[0.78rem] ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-dark';

export function LeadsInbox({ leads }: { leads: Lead[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<LeadStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads.filter((l) => {
      if (filter !== 'all' && l.status !== filter) return false;
      if (!q) return true;
      return (
        fullName(l).toLowerCase().includes(q) ||
        (l.email ?? '').toLowerCase().includes(q) ||
        (l.phone ?? '').toLowerCase().includes(q) ||
        (l.zip ?? '').toLowerCase().includes(q)
      );
    });
  }, [leads, filter, search]);

  async function setStatus(id: string, status: LeadStatus) {
    setBusyId(id);
    setError('');
    const res = await fetch('/api/leads', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    setBusyId(null);
    if (!res.ok) {
      setError('Could not update status');
      return;
    }
    router.refresh();
  }

  async function convert(id: string) {
    setBusyId(id);
    setError('');
    const res = await fetch('/api/leads', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action: 'convert' }),
    });
    setBusyId(null);
    if (!res.ok) {
      setError('Could not convert lead');
      return;
    }
    const data = (await res.json()) as { customer?: { id: string } };
    if (data.customer?.id) {
      router.push(`/clients/${data.customer.id}`);
    } else {
      router.refresh();
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {FILTERS.map((f) => {
          const count = f.key === 'all' ? leads.length : leads.filter((l) => l.status === f.key).length;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={
                'px-3 py-1.5 rounded-full text-[0.78rem] font-heading font-bold transition-colors ' +
                (filter === f.key
                  ? 'bg-brand text-white'
                  : 'bg-white border border-line text-muted hover:text-brand')
              }
            >
              {f.label}
              <span className="ml-1.5 opacity-70">{count}</span>
            </button>
          );
        })}
        <Input
          placeholder="Search name, email, zip"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs ml-auto"
        />
      </div>

      {error && <p className="text-sm text-danger mb-3">{error}</p>}

      {rows.length === 0 ? (
        <EmptyState
          title="No requests"
          hint="New website requests will show up here as they come in."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Lead</Th>
              <Th>Contact</Th>
              <Th>Dogs / Service</Th>
              <Th>Received</Th>
              <Th>Status</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id} className="hover:bg-[#fafafa] align-top">
                <Td>
                  <div className="flex items-center gap-3">
                    <Avatar initials={initials(l)} className="w-9 h-9 text-xs" />
                    <div>
                      <div className="font-heading font-bold text-ink">{fullName(l) || 'Unnamed'}</div>
                      <div className="text-xs text-muted">{l.zip || '·'}</div>
                    </div>
                  </div>
                </Td>
                <Td className="text-sm">
                  <div>{fmtPhone(l.phone) || '·'}</div>
                  <div className="text-xs text-muted">{l.email || '·'}</div>
                </Td>
                <Td className="text-sm">
                  <div>{l.dogs || '·'}</div>
                  <div className="text-xs text-muted">{l.service_type || '·'}</div>
                  {l.notes && <div className="text-xs text-muted mt-1 max-w-[16rem]">{l.notes}</div>}
                </Td>
                <Td className="text-sm whitespace-nowrap">{shortDate(l.created_at)}</Td>
                <Td>
                  <Select
                    value={l.status}
                    onChange={(e) => setStatus(l.id, e.target.value as LeadStatus)}
                    disabled={busyId === l.id || l.status === 'converted'}
                    className="py-1.5 text-sm w-32"
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                </Td>
                <Td className="text-right whitespace-nowrap">
                  <div className="inline-flex items-center gap-2">
                    {textLink(l) && (
                      <a href={textLink(l)} className={TEXT_LINK_CLASS}>
                        Text
                      </a>
                    )}
                    {l.status === 'converted' ? (
                      <StatusPill status="converted" />
                    ) : (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => convert(l.id)}
                        disabled={busyId === l.id}
                      >
                        {busyId === l.id ? '…' : 'Convert to client'}
                      </Button>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
