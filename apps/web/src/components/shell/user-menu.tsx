import { ChevronDown, UserRound } from 'lucide-react';

export function UserMenu() {
  return (
    <details className="relative">
      <summary className="flex min-h-[var(--touch-target)] cursor-pointer list-none items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <UserRound className="size-4" aria-hidden="true" />
        <span className="hidden sm:inline">Preview mode</span>
        <ChevronDown className="hidden size-3 sm:inline" aria-hidden="true" />
        <span className="sr-only sm:hidden">Preview mode details</span>
      </summary>
      <div className="absolute right-0 z-30 mt-2 w-56 rounded-lg border border-border bg-card p-3 text-sm text-card-foreground">
        <p className="font-medium">No account connected</p>
        <p className="mt-1 text-muted-foreground">
          Authentication belongs to a later phase.
        </p>
      </div>
    </details>
  );
}
