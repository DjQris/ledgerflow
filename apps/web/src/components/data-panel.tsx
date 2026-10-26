import type { ReactNode } from 'react';
import { Frame } from 'panelui-web/frame';

export function DataPanel({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Frame variant="band" className="min-w-0">
      <Frame.Header>
        <Frame.Title>{title}</Frame.Title>
        {description && <Frame.Description>{description}</Frame.Description>}
        {action && <Frame.Action>{action}</Frame.Action>}
      </Frame.Header>
      <Frame.Panel className="min-w-0">{children}</Frame.Panel>
    </Frame>
  );
}
