import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const Card = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('rounded-lg border border-line bg-card p-5', className)} {...p} />
);

export const Badge = ({ className, ...p }: HTMLAttributes<HTMLSpanElement>) => (
  <span className={cn('inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent', className)} {...p} />
);
