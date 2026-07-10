'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Table, Th, Td, StatusPill, Avatar, Input, EmptyState } from '@/components/ui';
import { ClientForm } from './ClientForm';
import { CardLinkButton } from './CardLinkButton';
import { money, phone as fmtPhone, fullName, initials } from '@/lib/format';
import type { Customer } from '@/lib/types';

export function ClientsTable({
  clients,
  dogCounts,
}: {
  clients: Customer[];
  dogCounts: Record<string, number>;
}) {
  const [search, setSearch] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients.filter((c) => {
      if (activeOnly && !c.active) return false;
      if (!q) return true;
      return (
        fullName(c).toLowerCase().includes(q) ||
        (c.address ?? '').toLowerCase().includes(q) ||
        (c.phone ?? '').toLowerCase().includes(q) ||
        (c.city ?? '').toLowerCase().includes(q)
      );
    });
  }, [clients, search, activeOnly]);

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Input
          placeholder="Search name, address, phone"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <label className="flex items-center gap-2 text-sm text-muted whitespace-nowrap">
          <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
          Active only
        </label>
        <span className="text-sm text-muted ml-auto">{rows.length} shown</span>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No clients match" hint="Try a different search or add a new client." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Client</Th>
              <Th>Plan</Th>
              <Th>Day</Th>
              <Th>Price</Th>
              <Th>Billing</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="hover:bg-[#fafafa]">
                <Td>
                  <Link href={`/clients/${c.id}`} className="flex items-center gap-3">
                    <Avatar initials={initials(c)} className="w-9 h-9 text-xs" />
                    <span>
                      <span className="block font-heading font-bold text-ink">{fullName(c) || 'Unnamed'}</span>
                      <span className="block text-xs text-muted">
                        {c.address ?? '·'}
                        {dogCounts[c.id] ? ` · ${dogCounts[c.id]} dog${dogCounts[c.id] > 1 ? 's' : ''}` : ''}
                      </span>
                    </span>
                  </Link>
                </Td>
                <Td className="text-sm">{c.service_type ?? '·'}</Td>
                <Td className="text-sm">{c.preferred_day ?? '·'}</Td>
                <Td className="text-sm">{c.price_per_visit != null ? money(c.price_per_visit) : '·'}</Td>
                <Td className="text-sm">
                  <span className="flex items-center gap-2">
                    {c.stripe_payment_method_id ? (
                      <span className="text-brand">Card on file</span>
                    ) : (
                      <span className="text-muted">No card</span>
                    )}
                    <CardLinkButton client={c} />
                  </span>
                </Td>
                <Td>
                  <StatusPill status={c.active ? 'active' : 'inactive'} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <div className="mt-5">
        <ClientForm />
      </div>
    </div>
  );
}
