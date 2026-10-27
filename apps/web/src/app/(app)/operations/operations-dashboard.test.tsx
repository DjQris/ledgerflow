import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { useMetrics } = vi.hoisted(() => ({ useMetrics: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/operations',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/operations/hooks', () => ({ useOperationsMetrics: useMetrics }));
vi.mock('panelui-web/stat', () => ({ Stat: Object.assign(({ children }: { children: React.ReactNode }) => <div>{children}</div>, { Content: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, Label: ({ children }: { children: React.ReactNode }) => <span>{children}</span>, Value: ({ children }: { children: React.ReactNode }) => <strong>{children}</strong>, Description: ({ children }: { children: React.ReactNode }) => <small>{children}</small> }) }));
vi.mock('panelui-web/day-grid', () => ({ DayGrid: Object.assign(({ cells, label }: { cells: { label: string; level: number }[]; label: string }) => <div aria-label={label}>{cells.map((cell) => <span key={cell.label} data-level={cell.level}>{cell.label}</span>)}</div>, { Legend: () => null }) }));
vi.mock('panelui-web/bar-picker', () => ({ BarPicker: ({ data, label, formatValue }: { data: { name: string; value: number }[]; label: string; formatValue: (value: number) => string }) => <ul aria-label={label}>{data.map((item) => <li key={item.name}>{item.name}: {formatValue(item.value)}</li>)}</ul> }));

import { useOperationsMetrics } from '@/lib/operations/hooks';
import { OperationsDashboard } from './operations-dashboard';

const metrics = vi.mocked(useOperationsMetrics);
const result = {
  from: '2026-10-01', to: '2026-10-02', timeZone: 'UTC' as const,
  completedCount: 2, completedMinor: '2500', recordedFailedTransferCount: 1,
  registeredUsers: 7, pendingRetries: 2, pendingOutboxEvents: 1,
  daily: [
    { date: '2026-10-01', completedCount: 2, failedCount: 0, completedMinor: '2000' },
    { date: '2026-10-02', completedCount: 0, failedCount: 1, completedMinor: '0' },
  ],
  recentActivity: [{ action: 'account_suspended', entityType: 'user', actorType: 'user', outcome: 'SUCCEEDED', occurredAt: '2026-10-02T12:00:00Z' }],
  apiReadiness: 'ready' as const,
};

describe('OperationsDashboard', () => {
  beforeEach(() => metrics.mockReset());

  it('renders backend totals and charts with exact daily completed and failed counts', () => {
    metrics.mockReturnValue({ data: result, isPending: false, isError: false, isFetching: false } as ReturnType<typeof useOperationsMetrics>);
    render(<OperationsDashboard />);
    expect(screen.getByText('₦25.00')).toBeInTheDocument();
    expect(screen.getByText('Completed transfers', { selector: 'span' }).parentElement).toHaveTextContent('2');
    expect(screen.getByText('Pending operational work', { selector: 'span' }).parentElement).toHaveTextContent('3');
    expect(screen.getByRole('list', { name: 'Daily completed transfer count' })).toHaveTextContent('2026-10-01: 2 completed transfers');
    expect(screen.getByRole('list', { name: 'Daily recorded failed transfer count' })).toHaveTextContent('2026-10-02: 1 recorded failed transfers');
    expect(screen.getByText(/2026-10-02, 1 recorded transfers/)).toBeInTheDocument();
    expect(screen.getByText('account suspended')).toBeInTheDocument();
  });

  it('shows an empty state for a real all-zero response and no fixture totals', () => {
    metrics.mockReturnValue({ data: { ...result, completedCount: 0, completedMinor: '0', recordedFailedTransferCount: 0, daily: result.daily.map((day) => ({ ...day, completedCount: 0, failedCount: 0, completedMinor: '0' })), recentActivity: [] }, isPending: false, isError: false, isFetching: false } as unknown as ReturnType<typeof useOperationsMetrics>);
    render(<OperationsDashboard />);
    expect(screen.getByText('No transfer activity in this period')).toBeInTheDocument();
    expect(screen.getByText('No recent system activity')).toBeInTheDocument();
    expect(screen.queryByText('₦1,234,567.89')).not.toBeInTheDocument();
  });

  it('shows loading and backend outage states without sample data', () => {
    metrics.mockReturnValue({ data: undefined, isPending: true, isError: false, refetch: vi.fn() } as unknown as ReturnType<typeof useOperationsMetrics>);
    const { rerender } = render(<OperationsDashboard />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading operational metrics');
    metrics.mockReturnValue({ data: undefined, isPending: false, isError: true, refetch: vi.fn() } as unknown as ReturnType<typeof useOperationsMetrics>);
    rerender(<OperationsDashboard />);
    expect(screen.getByText('Operational data is unavailable')).toBeInTheDocument();
    expect(screen.queryByText('₦1,234,567.89')).not.toBeInTheDocument();
  });
});
