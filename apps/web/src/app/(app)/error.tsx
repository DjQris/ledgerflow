'use client';

import { ErrorState } from '@/components/states';

export default function WorkspaceError({
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return <ErrorState onRetry={retry} />;
}
