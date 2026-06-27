import type { ReactNode } from 'react';

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="bg-white rounded-card border border-line py-12 px-6 text-center">
      <p className="font-heading font-bold text-ink">{title}</p>
      {hint && <p className="text-sm text-muted mt-1.5">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
