'use client';

import { Alert } from 'panelui-web/alert';
import { Inbox, RefreshCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';

export function LoadingState({
  label = 'Loading content',
}: {
  label?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="space-y-3 rounded-lg border border-border bg-card p-6"
    >
      <span className="sr-only">{label}</span>
      <div
        aria-hidden="true"
        className="h-4 w-40 rounded bg-muted motion-safe:animate-pulse"
      />
      <div
        aria-hidden="true"
        className="h-3 w-full max-w-md rounded bg-muted motion-safe:animate-pulse"
      />
      <div
        aria-hidden="true"
        className="h-3 w-2/3 rounded bg-muted motion-safe:animate-pulse"
      />
    </div>
  );
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center px-5 py-8 text-center">
      <Inbox aria-hidden="true" className="size-7 text-muted-foreground" />
      <h3 className="mt-3 text-sm font-semibold">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

export function ErrorState({
  title = 'This view could not load',
  description = 'Please try again. No financial action was submitted.',
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <Alert tone="destructive" variant="plain" role="alert">
      <Alert.Icon />
      <Alert.Title>{title}</Alert.Title>
      <Alert.Description>{description}</Alert.Description>
      {onRetry && (
        <Alert.Actions>
          <Button type="button" variant="outline" onClick={onRetry}>
            <RefreshCcw className="size-4" aria-hidden="true" /> Retry
          </Button>
        </Alert.Actions>
      )}
    </Alert>
  );
}
