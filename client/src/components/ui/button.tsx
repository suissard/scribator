import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { Spinner } from './spinner';

const variants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium text-center leading-snug transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50 cursor-pointer',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-white shadow-sm hover:bg-accent/90 active:translate-y-px',
        success: 'bg-ok text-white shadow-sm hover:bg-ok/90 active:translate-y-px',
        secondary: 'border border-ink/20 bg-surface text-ink shadow-xs hover:bg-accent-soft hover:border-accent/40',
        tool: 'border border-accent/25 bg-accent-soft/75 text-accent hover:bg-accent-soft hover:border-accent/50',
        ghost: 'text-muted hover:text-ink hover:bg-accent-soft/60',
        danger: 'border border-danger/45 bg-card text-danger hover:bg-danger/10',
        dangerSolid: 'bg-danger text-white shadow-sm hover:bg-danger/90 active:translate-y-px',
      },
      size: {
        sm: 'min-h-8 px-3 py-1.5 text-sm',
        md: 'min-h-10 px-4 py-2 text-sm',
        lg: 'min-h-12 px-5 py-2.5 text-base font-semibold',
        xl: 'min-h-14 px-6 py-3 text-lg font-bold',
        icon: 'h-9 w-9 p-0 shrink-0',
      },
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
  const classes = cn(variants({ variant, size }), className);
  if (asChild) {
    // Slot exige un unique enfant : aucun nœud supplémentaire (même `false`) ne doit lui être passé.
    return (
      <Slot className={classes} aria-busy={loading || undefined} {...props}>
        {children}
      </Slot>
    );
  }
  return (
    <button
      type={type ?? 'button'}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Spinner size={14} />}
      {children}
    </button>
  );
}
