'use client';

import { AlertDialog } from 'panelui-web/alert-dialog';

import { Button } from '@/components/ui/button';

export function ConfirmationDialog({
  triggerLabel,
  title,
  description,
  confirmLabel,
  onConfirm,
  disabled = false,
}: {
  triggerLabel: string;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  return (
    <AlertDialog>
      <AlertDialog.Trigger render={<Button type="button" variant="outline" disabled={disabled} />}>
        {triggerLabel}
      </AlertDialog.Trigger>
      <AlertDialog.Content size="sm">
        <AlertDialog.Title>{title}</AlertDialog.Title>
        <AlertDialog.Description>{description}</AlertDialog.Description>
        <AlertDialog.Footer>
          <AlertDialog.Cancel />
          <AlertDialog.Action onClick={onConfirm} disabled={disabled}>
            {confirmLabel}
          </AlertDialog.Action>
        </AlertDialog.Footer>
      </AlertDialog.Content>
    </AlertDialog>
  );
}
