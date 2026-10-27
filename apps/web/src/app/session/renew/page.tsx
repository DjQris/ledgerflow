'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError, refreshSession } from '@/lib/auth/client';

export default function RenewPage() {
  const router = useRouter();
  const started = useRef(false);
  const [error, setError] = useState(false);
  const renew = useCallback(async () => {
    setError(false);
    try {
      await refreshSession();
      router.replace('/dashboard');
      router.refresh();
    } catch (reason) {
      if (reason instanceof ApiError && [401, 403].includes(reason.status)) {
        router.replace('/login');
      } else {
        setError(true);
      }
    }
  }, [router]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void renew();
  }, [renew]);

  return <main className="flex min-h-screen items-center justify-center px-4">
    <div className="max-w-sm space-y-4 text-center">
      <h1 className="text-xl font-semibold">Restoring your session</h1>
      {error ? <>
        <p role="alert" className="text-sm text-muted-foreground">The service is unavailable. Your session was not changed.</p>
        <button type="button" onClick={() => void renew()} className="rounded-md border border-border px-4 py-2">Retry</button>
        <p><Link href="/login" className="text-sm underline">Return to sign in</Link></p>
      </> : <p role="status" className="text-sm text-muted-foreground">Please wait…</p>}
    </div>
  </main>;
}
