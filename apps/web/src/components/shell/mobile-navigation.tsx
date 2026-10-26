'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Landmark, Menu, X } from 'lucide-react';

import { NavLinks } from './nav-links';

export function MobileNavigation({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <div className="lg:hidden">
      <button
        ref={triggerRef}
        type="button"
        aria-label={open ? 'Close navigation' : 'Open navigation'}
        aria-expanded={open}
        aria-controls="mobile-navigation-panel"
        onClick={() => setOpen((value) => !value)}
        className="flex size-[var(--touch-target)] items-center justify-center rounded-lg border border-border"
      >
        {open ? (
          <X className="size-5" aria-hidden="true" />
        ) : (
          <Menu className="size-5" aria-hidden="true" />
        )}
      </button>
      {open && (
        <nav
          id="mobile-navigation-panel"
          aria-label="Mobile primary"
          className="absolute inset-x-0 top-full max-h-[calc(100dvh-4rem)] overflow-y-auto border-b border-border bg-background p-4"
        >
          <Link
            href="/dashboard"
            onClick={() => setOpen(false)}
            className="mb-5 flex min-h-[var(--touch-target)] items-center gap-2 font-semibold"
          >
            <Landmark className="size-5" aria-hidden="true" /> LedgerFlow
          </Link>
          <NavLinks pathname={pathname} onNavigate={() => setOpen(false)} />
        </nav>
      )}
    </div>
  );
}
