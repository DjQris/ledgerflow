import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { useReport } = vi.hoisted(() => ({ useReport: vi.fn() }));
vi.mock('@/lib/operations/center-hooks', () => ({ useLedgerReconciliation: useReport }));

import { useLedgerReconciliation } from '@/lib/operations/center-hooks';
import { ReconciliationReport } from './reconciliation-report';

const hook = vi.mocked(useLedgerReconciliation);
const report = { reportId: 'a5e0df47-36f4-4314-8a04-71464ba8996c', checkedAt: '2026-10-27T10:00:00Z', accountCount: '8', journalCount: '12', walletCount: '7', ok: false, issues: [{ code: 'WALLET_BALANCE_MISMATCH', resourceType: 'wallet' as const, resourceId: 'b5e0df47-36f4-4314-8a04-71464ba8996c', detail: { ledgerTotalMinor: '100', projectedBalanceMinor: '90' } }] };

describe('ReconciliationReport', () => {
  beforeEach(() => hook.mockReturnValue({ data: report, dataUpdatedAt: Date.parse(report.checkedAt), isPending: false, isError: false, isFetching: false, isStale: false, refetch: vi.fn() } as unknown as ReturnType<typeof useLedgerReconciliation>));

  it('shows exact backend counts and discrepancy references without implying an external settlement comparison', async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    hook.mockReturnValue({ data: report, dataUpdatedAt: Date.parse(report.checkedAt), isPending: false, isError: false, isFetching: false, isStale: false, refetch } as unknown as ReturnType<typeof useLedgerReconciliation>);
    render(<ReconciliationReport />);
    expect(screen.getByText('Report ID: a5e0df47-36f4-4314-8a04-71464ba8996c')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('Record: b5e0df47-36f4-4314-8a04-71464ba8996c')).toBeInTheDocument();
    expect(screen.queryByText(/external settlement/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Run verification again' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('distinguishes no issues from a verifier outage', () => {
    hook.mockReturnValue({ data: { ...report, ok: true, issues: [] }, isPending: false, isError: false } as unknown as ReturnType<typeof useLedgerReconciliation>);
    const { rerender } = render(<ReconciliationReport />);
    expect(screen.getByText('No integrity discrepancies found')).toBeInTheDocument();
    hook.mockReturnValue({ data: undefined, isPending: false, isError: true, refetch: vi.fn() } as unknown as ReturnType<typeof useLedgerReconciliation>);
    rerender(<ReconciliationReport />);
    expect(screen.getByText('Reconciliation service unavailable')).toBeInTheDocument();
  });
});
