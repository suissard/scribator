import { LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Spinner = ({ size = 16, className }: { size?: number; className?: string }) => (
  <LoaderCircle aria-hidden="true" size={size} className={cn('shrink-0 animate-spin', className)} />
);
