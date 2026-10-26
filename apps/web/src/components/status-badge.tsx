import { cn } from '@/lib/utils';

const toneClasses = {
  primary: 'bg-primary/10',
  info: 'bg-info/10',
  success: 'bg-success/10',
  warning: 'bg-warning/10',
  destructive: 'bg-destructive/10',
  neutral: 'bg-muted',
} as const;

const dotClasses = {
  primary: 'bg-primary',
  info: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  neutral: 'bg-muted-foreground',
} as const;

export type StatusTone = keyof typeof toneClasses;

export function StatusBadge({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: StatusTone;
}) {
  return (
    <span
      className={cn(
        'inline-flex min-h-7 items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-foreground',
        toneClasses[tone],
      )}
    >
      <span
        aria-hidden="true"
        className={cn('size-1.5 rounded-full', dotClasses[tone])}
      />
      {label}
    </span>
  );
}
