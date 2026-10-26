'use client';

import { useState } from 'react';
import { Card } from 'panelui-web/card';
import { RollingNumber } from 'panelui-web/rolling-number';

import { Button } from '@/components/ui/button';

export function UiCheck() {
  const [dark, setDark] = useState(false);
  const [count, setCount] = useState(0);

  return (
    <main className={dark ? 'dark' : ''}>
      <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
        <div className="w-full max-w-xl rounded-2xl bg-muted p-3">
          <div className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            LedgerFlow · Phase 3A
          </div>
          <Card as="section">
            <Card.Header>
              <Card.Title as="h2">UI installation check</Card.Title>
              <Card.Description>
                Next.js, Tailwind CSS 4, Geist, shadcn-style controls, and
                PanelUI Web.
              </Card.Description>
            </Card.Header>
            <Card.Content className="space-y-5">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">
                  Interactive count
                </p>
                <RollingNumber
                  value={count}
                  className="font-mono text-5xl font-semibold"
                />
              </div>
              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  onClick={() => setCount((value) => value + 1)}
                >
                  Increment
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDark((value) => !value)}
                >
                  Use {dark ? 'light' : 'dark'} theme
                </Button>
              </div>
            </Card.Content>
            <Card.Footer variant="panel">
              <p className="text-xs text-muted-foreground">
                PanelUI Card and Rolling Number loaded from the official web npm
                package.
              </p>
            </Card.Footer>
          </Card>
        </div>
      </div>
    </main>
  );
}
