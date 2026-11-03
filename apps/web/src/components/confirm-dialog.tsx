/** In-page modal built on GlassDialog; never uses window.confirm. */
import type { ReactNode } from "react";
import { GlassDialog, GlassDialogContent, GlassDialogTitle } from "./glassyui/glass-dialog.tsx";
import { Button } from "./ui-primitives.tsx";

interface Props {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  confirmDisabled?: boolean;
  onConfirm(): void;
  onCancel(): void;
}

export function ConfirmDialog({ open, title, children, confirmLabel, danger, confirmDisabled, onConfirm, onCancel }: Props) {
  return (
    <GlassDialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <GlassDialogContent className="w-[min(92vw,560px)] p-6" aria-describedby={undefined}>
        <GlassDialogTitle className="mb-4 pr-10 text-lg font-semibold">{title}</GlassDialogTitle>
        <div className="mb-5 space-y-3 text-sm">{children}</div>
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant={danger ? "danger" : "primary"} disabled={confirmDisabled} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </GlassDialogContent>
    </GlassDialog>
  );
}
