import { cn } from './utils';

interface StatCardProps {
  label: string;
  value: string | number;
  tone?: 'default' | 'success' | 'warn' | 'info' | 'danger';
}

const tones: Record<NonNullable<StatCardProps['tone']>, string> = {
  default: 'text-brand-dark',
  success: 'text-brand',
  warn: 'text-warn',
  info: 'text-info',
  danger: 'text-danger',
};

export function StatCard({ label, value, tone = 'default' }: StatCardProps) {
  return (
    <div className="bg-white rounded-card border border-line px-6 py-5">
      <div className={cn('font-heading text-[2.2rem] font-black leading-none', tones[tone])}>
        {value}
      </div>
      <div className="text-[0.85rem] text-muted font-semibold mt-1.5">{label}</div>
    </div>
  );
}
