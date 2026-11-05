import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const base =
  'w-full rounded-md border border-line bg-card px-3 py-2 text-sm placeholder:text-muted/70 focus:outline-2 focus:outline-accent disabled:opacity-60';

export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input className={cn(base, 'h-10', className)} {...p} />;

export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea className={cn(base, 'min-h-24', className)} {...p} />;

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}
