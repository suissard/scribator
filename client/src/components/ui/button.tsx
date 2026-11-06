import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { Spinner } from './spinner';

const variants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50 cursor-pointer',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-white hover:bg-accent/90',
        secondary: 'border border-line bg-card hover:bg-accent-soft',
        ghost: 'hover:bg-accent-soft',
        danger: 'border border-danger/40 text-danger bg-card hover:bg-danger/10',
      },
      size: { sm: 'h-8 px-3', md: 'h-10 px-4', icon: 'h-8 w-8' },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

interface Props extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof variants> {
  asChild?: boolean;
  /** Indique une action en cours. Sans effet avec `asChild`, qui n'accepte qu'un seul enfant. */
  loading?: boolean;
}

export function Button({ className, variant, size, asChild, type, loading, children, disabled, ...props }: Props) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      type={asChild ? undefined : (type ?? 'button')}
      className={cn(variants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && !asChild && <Spinner size={14} />}
      {children}
    </Comp>
  );
}
