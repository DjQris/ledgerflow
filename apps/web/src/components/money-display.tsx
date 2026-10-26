import { cn } from '@/lib/utils';
import { formatMinor } from '@/lib/money';

export function MoneyDisplay({
  amountMinor,
  className,
}: {
  amountMinor: string;
  className?: string;
}) {
  const formatted = formatMinor(amountMinor);
  return (
    <span
      aria-label={formatted.accessible}
      className={cn('font-mono tabular-nums', className)}
    >
      {formatted.text}
    </span>
  );
}
