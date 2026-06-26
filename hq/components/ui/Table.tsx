import type { HTMLAttributes, ThHTMLAttributes, TdHTMLAttributes } from 'react';
import { cn } from './utils';

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="bg-white rounded-card border border-line overflow-x-auto">
      <table className={cn('w-full border-collapse', className)} {...props} />
    </div>
  );
}

export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'bg-tan px-4 py-3 text-left font-heading text-[0.74rem] font-bold text-muted uppercase tracking-wider whitespace-nowrap',
        className
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn('px-4 py-3.5 border-t border-line align-middle', className)}
      {...props}
    />
  );
}
