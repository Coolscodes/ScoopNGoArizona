import Link from 'next/link';
import { PageHeader } from '@/components/ui';

// Foundation landing page. Once Workstream 1 ships /dashboard, this can redirect there.
const WORKSTREAMS = [
  { n: 1, label: 'Dashboard', href: '/dashboard' },
  { n: 2, label: 'Route & scheduling', href: '/route' },
  { n: 3, label: 'Clients', href: '/clients' },
  { n: 4, label: 'Leads & Quotes', href: '/leads' },
  { n: 5, label: 'Field tool', href: '/field' },
  { n: 6, label: 'Invoices & payments', href: '/invoices' },
  { n: 7, label: 'Customer portal', href: '/my-account' },
  { n: 8, label: 'Automations', href: '/automations' },
];

export default function HubHome() {
  return (
    <div>
      <PageHeader
        title="Foundation is ready"
        subtitle="Auth, database, shared types, and the UI kit are live. Build the workstreams below."
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {WORKSTREAMS.map((w) => (
          <Link
            key={w.n}
            href={w.href}
            className="bg-white rounded-card border border-line px-5 py-4 hover:border-brand transition-colors"
          >
            <div className="text-[0.72rem] font-heading font-bold text-muted">
              Workstream {w.n}
            </div>
            <div className="font-heading font-bold text-ink">{w.label}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
