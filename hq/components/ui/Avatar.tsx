import { cn } from './utils';

export function Avatar({
  initials,
  className,
}: {
  initials: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-full bg-brand-light text-brand-dark font-heading font-bold w-11 h-11 text-sm shrink-0',
        className
      )}
    >
      {initials}
    </div>
  );
}
