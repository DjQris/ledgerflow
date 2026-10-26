import { Stat } from 'panelui-web/stat';

import { DataPanel } from '@/components/data-panel';
import { PageHeader } from '@/components/page-header';
import { PageSection } from '@/components/page-section';
import { EmptyState } from '@/components/states';
import { StatusBadge } from '@/components/status-badge';
import { routeShells, type RouteShellPath } from '@/lib/route-shells';

export function PlaceholderPage({ route }: { route: RouteShellPath }) {
  const shell = routeShells[route];
  const columns: readonly string[] = 'columns' in shell ? shell.columns : [];
  const metric = 'metric' in shell ? shell.metric : undefined;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={`${shell.workspace} workspace`}
        title={shell.title}
        description={shell.description}
        actions={<StatusBadge tone="info" label="UI preview only" />}
      />
      <PageSection
        title="Workspace preview"
        description="These are layout placeholders, not connected financial data or actions."
      >
        {metric && (
          <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <DataPanel
              title={metric}
              description="No account or service connected"
            >
              <div className="p-5">
                <Stat>
                  <Stat.Content>
                    <Stat.Label>Current reading</Stat.Label>
                    <Stat.Value>—</Stat.Value>
                  </Stat.Content>
                  <Stat.Badge>Unavailable</Stat.Badge>
                </Stat>
              </div>
            </DataPanel>
          </div>
        )}
        <DataPanel
          title={columns.length ? 'Records' : 'Content area'}
          description="Awaiting a later integration phase"
        >
          {columns.length ? (
            <div className="min-w-0">
              <p className="px-4 pt-3 text-xs text-muted-foreground sm:hidden">
                Scroll horizontally to see all columns.
              </p>
              <div
                className="max-w-full overflow-x-auto"
                role="region"
                aria-label={`${shell.title} table`}
                tabIndex={0}
              >
                <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
                  <thead className="border-b border-border bg-muted/50">
                    <tr>
                      {columns.map((column) => (
                        <th
                          scope="col"
                          key={column}
                          className="px-4 py-3 font-semibold"
                        >
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td
                        colSpan={columns.length}
                        className="px-4 py-8 text-center text-muted-foreground"
                      >
                        No live records are connected in Phase 3B.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <EmptyState
              title="Nothing connected yet"
              description="This shell establishes the layout only. No account, wallet, transfer, or operations action is available."
            />
          )}
        </DataPanel>
      </PageSection>
    </div>
  );
}
