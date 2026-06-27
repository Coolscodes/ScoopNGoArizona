import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from './utils';

type Variant = 'primary' | 'outline' | 'danger' | 'ghost';
type Size = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variants: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-dark border border-transparent',
  outline: 'bg-transparent text-muted border-2 border-line hover:border-brand hover:text-brand',
  danger: 'bg-[#ffebee] text-danger border border-[#ffcdd2] hover:bg-[#ffcdd2]',
  ghost: 'bg-transparent text-muted border border-transparent hover:bg-black/5',
};

const sizes: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-[0.78rem]',
  md: 'px-4 py-2.5 text-[0.82rem]',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'outline', size = 'md', className, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-[7px] font-heading font-bold cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    />
  );
});
