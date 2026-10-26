'use client';

import { AlertDialog } from 'panelui-web/alert-dialog';

import { Button } from '@/components/ui/button';

export function ConfirmationDialog({
  triggerLabel,
  title,
  description,
  confirmLabel,
  onConfirm,
}: {
  triggerLabel: string;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialog.Trigger render={<Button type="button" variant="outline" />}>
        {triggerLabel}
      </AlertDialog.Trigger>
      <AlertDialog.Content size="sm">
        <AlertDialog.Title>{title}</AlertDialog.Title>
        <AlertDialog.Description>{description}</AlertDialog.Description>
        <AlertDialog.Footer>
          <AlertDialog.Cancel />
          <AlertDialog.Action onClick={onConfirm}>
            {confirmLabel}
          </AlertDialog.Action>
        </AlertDialog.Footer>
      </AlertDialog.Content>
    </AlertDialog>
  );
}
