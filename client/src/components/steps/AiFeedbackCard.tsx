import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/field';
import { VoiceDictationButton } from '@/components/ui/VoiceTools';
import { cn } from '@/lib/utils';

export function AiFeedbackCard({
  title,
  description,
  placeholder,
  actionLabel,
  loadingLabel,
  value,
  onChange,
  onSubmit,
  disabled = false,
  loading = false,
  voice = false,
  simple = false,
  ariaLabel,
  className,
}: {
  title: string;
  description: string;
  placeholder: string;
  actionLabel: string;
  loadingLabel?: string;
  value: string;
  onChange(next: string): void;
  onSubmit(): void;
  disabled?: boolean;
  loading?: boolean;
  voice?: boolean;
  simple?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  const canSubmit = !disabled && !loading && value.trim().length > 0;

  return (
    <Card className={cn('space-y-3 border-accent/30 bg-accent-soft/25', simple ? 'space-y-4 p-5' : 'p-4', className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <h2 className={cn('flex items-center gap-2 font-semibold text-ink', simple ? 'font-serif text-lg font-bold' : 'text-sm')}>
            <Sparkles size={simple ? 18 : 15} className="shrink-0 text-accent" aria-hidden="true" />
            {title}
          </h2>
          <p className={cn('text-muted', simple ? 'text-sm' : 'text-xs')}>{description}</p>
        </div>
        {voice && (
          <VoiceDictationButton
            compact
            label="Dicter mes correctifs"
            value={value}
            onChange={onChange}
          />
        )}
      </div>

      <Textarea
        aria-label={ariaLabel ?? title}
        className={cn(simple ? 'min-h-24 text-base' : 'min-h-20 text-sm')}
        placeholder={placeholder}
        value={value}
        disabled={disabled || loading}
        onChange={(e) => onChange(e.target.value)}
      />

      <div className="flex flex-wrap items-center justify-end gap-2">
        {value.trim().length > 0 && !loading && (
          <Button type="button" variant="ghost" size={simple ? 'md' : 'sm'} disabled={disabled} onClick={() => onChange('')}>
            Effacer
          </Button>
        )}
        <Button
          type="button"
          variant="primary"
          size={simple ? 'lg' : 'md'}
          disabled={!canSubmit}
          loading={loading}
          onClick={onSubmit}
        >
          {!loading && <Sparkles size={simple ? 18 : 15} />}
          {loading ? (loadingLabel ?? 'Application des correctifs…') : actionLabel}
        </Button>
      </div>
    </Card>
  );
}
