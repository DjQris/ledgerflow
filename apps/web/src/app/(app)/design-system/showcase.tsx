'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Alert } from 'panelui-web/alert';
import { Input } from 'panelui-web/input';
import { Label } from 'panelui-web/label';
import { Stat } from 'panelui-web/stat';
import { Tabs } from 'panelui-web/tabs';

import { ConfirmationDialog } from '@/components/confirmation-dialog';
import { DataPanel } from '@/components/data-panel';
import { MoneyDisplay } from '@/components/money-display';
import { PageHeader } from '@/components/page-header';
import { PageSection } from '@/components/page-section';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { StatusBadge } from '@/components/status-badge';
import { useTheme } from '@/components/theme-provider';
import { Button } from '@/components/ui/button';

export function DesignSystemShowcase() {
  const { theme, toggleTheme } = useTheme();
  const [message, setMessage] = useState('No demo action yet.');

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Development only · sample fixtures"
        title="Design system"
        description="A visual check for shared components. All amounts, labels, and states below are examples; this page does not read or change financial data."
        actions={
          <Button type="button" variant="outline" onClick={toggleTheme}>
            Use {theme === 'dark' ? 'light' : 'dark'} theme
          </Button>
        }
      />

      <PageSection
        title="Foundations"
        description="Geist typography, semantic tokens, and monospaced numerals."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <DataPanel
            title="Typography"
            description="Type hierarchy with no decorative font substitutions"
          >
            <div className="space-y-3 p-5">
              <p className="text-2xl font-semibold tracking-tight">
                Workspace heading
              </p>
              <p className="text-base">
                Primary body text for decisions and records.
              </p>
              <p className="text-sm text-muted-foreground">
                Secondary information is quieter, not hidden.
              </p>
              <p className="font-mono text-sm tabular-nums">
                Reference: LF-2026-0042
              </p>
            </div>
          </DataPanel>
          <DataPanel
            title="Semantic colors"
            description="Surface, focus, and status roles"
          >
            <div className="flex flex-wrap gap-2 p-5">
              <StatusBadge tone="primary" label="Primary" />
              <StatusBadge tone="info" label="Information" />
              <StatusBadge tone="success" label="Success" />
              <StatusBadge tone="warning" label="Warning" />
              <StatusBadge tone="destructive" label="Destructive" />
              <StatusBadge tone="neutral" label="Neutral" />
            </div>
          </DataPanel>
        </div>
      </PageSection>

      <PageSection
        title="Data and panels"
        description="Demonstration figures are deliberately separate from live balances."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <DataPanel
            title="Example amount"
            description="Fixture only · not a wallet balance"
          >
            <div className="p-5">
              <Stat>
                <Stat.Content>
                  <Stat.Label>Sample amount</Stat.Label>
                  <Stat.Value>
                    <MoneyDisplay amountMinor="123456789" />
                  </Stat.Value>
                </Stat.Content>
              </Stat>
            </div>
          </DataPanel>
          <DataPanel
            title="Actions"
            description="shadcn-style local Button and PanelUI dialog"
          >
            <div className="flex flex-wrap items-center gap-3 p-5">
              <Button
                type="button"
                onClick={() =>
                  setMessage('Demo button pressed; no data changed.')
                }
              >
                Primary action
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setMessage('Secondary demo button pressed.')}
              >
                Secondary action
              </Button>
              <ConfirmationDialog
                triggerLabel="Open confirmation"
                title="Confirm demo action?"
                description="This is a design-system example. It will not submit or modify anything."
                confirmLabel="Confirm demo"
                onConfirm={() => setMessage('Demo confirmed; no data changed.')}
              />
              <p
                role="status"
                aria-live="polite"
                className="w-full text-sm text-muted-foreground"
              >
                {message}
              </p>
            </div>
          </DataPanel>
        </div>
      </PageSection>

      <PageSection
        title="Forms and navigation"
        description="Keyboard controls, explicit labels, and linkable routes."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <DataPanel
            title="Form controls"
            description="These fields do not submit"
          >
            <div className="space-y-4 p-5">
              <div className="space-y-2">
                <Label htmlFor="demo-reference">Sample reference</Label>
                <Input
                  id="demo-reference"
                  placeholder="Enter a reference"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="demo-email" optional>
                  Email
                </Label>
                <Input
                  id="demo-email"
                  type="email"
                  placeholder="example@company.test"
                  autoComplete="off"
                />
              </div>
            </div>
          </DataPanel>
          <DataPanel
            title="Section navigation"
            description="Tabs and application links"
          >
            <div className="space-y-5 p-5">
              <Tabs defaultValue="customer">
                <Tabs.List aria-label="Workspace examples">
                  <Tabs.Trigger value="customer">Customer</Tabs.Trigger>
                  <Tabs.Trigger value="operations">Operations</Tabs.Trigger>
                </Tabs.List>
                <Tabs.Content
                  value="customer"
                  className="pt-3 text-sm text-muted-foreground"
                >
                  Customer views prioritize balance clarity and safe transfer
                  entry.
                </Tabs.Content>
                <Tabs.Content
                  value="operations"
                  className="pt-3 text-sm text-muted-foreground"
                >
                  Operations views prioritize dense review and status scanning.
                </Tabs.Content>
              </Tabs>
              <nav
                aria-label="Example destinations"
                className="flex flex-wrap gap-4 text-sm"
              >
                <Link
                  className="underline underline-offset-4"
                  href="/dashboard"
                >
                  Customer shell
                </Link>
                <Link
                  className="underline underline-offset-4"
                  href="/operations"
                >
                  Operations shell
                </Link>
              </nav>
            </div>
          </DataPanel>
        </div>
      </PageSection>

      <PageSection
        title="Feedback states"
        description="Clear messages for loading, empty, error, and attention states."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <LoadingState label="Demo content loading" />
          <DataPanel title="Empty view">
            <EmptyState
              title="No demo records"
              description="A later integration will supply real data."
            />
          </DataPanel>
          <Alert tone="info" variant="plain">
            <Alert.Icon />
            <Alert.Title>Preview environment</Alert.Title>
            <Alert.Description>
              No live account or backend is connected to this page.
            </Alert.Description>
          </Alert>
          <ErrorState
            title="Example error"
            description="This is a fixture, not a failed financial operation."
          />
        </div>
      </PageSection>
    </div>
  );
}
