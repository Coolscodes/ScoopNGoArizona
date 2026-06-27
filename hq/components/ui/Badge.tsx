import type { ReactNode } from 'react';
import { cn } from './utils';

// Status -> color, covering lead / appointment / invoice / quote statuses.
const statusStyles: Record<string, string> = {
  new: 'bg-[#e3f2fd] text-[#1565c0]',
  contacted: 'bg-[#fff8e1] text-[#f57f17]',
  converted: 'bg-[#e8f5e9] text-[#2e7d32]',
  lost: 'bg-[#ffebee] text-[#c62828]',
  scheduled: 'bg-[#e3f2fd] text-[#1565c0]',
  completed: 'bg-[#e8f5e9] text-[#2e7d32]',
  skipped: 'bg-[#f3e5f5] text-[#6a1b9a]',
  cancelled: 'bg-[#ffebee] text-[#c62828]',
  draft: 'bg-[#f5f5f5] text-[#616161]',
  sent: 'bg-[#e3f2fd] text-[#1565c0]',
  paid: 'bg-[#e8f5e9] text-[#2e7d32]',
  overdue: 'bg-[#ffebee] text-[#c62828]',
  approved: 'bg-[#e8f5e9] text-[#2e7d32]',
  declined: 'bg-[#ffebee] text-[#c62828]',
  active: 'bg-[#e8f5e9] text-[#2e7d32]',
  inactive: 'bg-[#f5f5f5] text-[#616161]',
};

export function Badge({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-block px-2.5 py-0.5 rounded-full text-[0.72rem] font-heading font-bold',
        className
      )}
    >
      {children}
    </span>
  );
}

export function StatusPill({ status }: { status?: string | null }) {
  const key = (status ?? '').toLowerCase();
  return (
    <Badge className={statusStyles[key] ?? 'bg-[#f5f5f5] text-[#616161]'}>
      {status ?? '—'}
    </Badge>
  );
}
