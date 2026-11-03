/**
 * Import AutoEQ text or preset JSON. Imported presets are untrusted: they are
 * validated, given a clip-safe preamp, previewed, and only then saved/applied.
 */
import { useEffect, useState } from "react";
import { prepareImport, type ImportDraft } from "../state/preset-store.ts";
import { ConfirmDialog } from "./confirm-dialog.tsx";

interface Props {
  open: boolean;
  /** False when no confirmed DAC is connected; "apply now" is then unavailable. */
  canApply: boolean;
  /** Prefills the text box, e.g. with a preset opened from a share link. */
  initialText?: string | null;
  onCancel(): void;
  onImport(draft: ImportDraft, applyNow: boolean): void;
}

export function PresetImportDialog({ open, canApply, initialText, onCancel, onImport }: Props) {
  const [text, setText] = useState("");
  useEffect(() => {
    if (open && initialText) setText(initialText);
  }, [open, initialText]);
  const [name, setName] = useState("Imported");
  const [applyNow, setApplyNow] = useState(false);
  let draft: ImportDraft | null = null;
  let error: string | null = null;
  if (text.trim()) {
    try {
      draft = prepareImport(text, name);
    } catch (e) {
      error = (e as Error).message;
    }
  }
  const close = () => (setText(""), onCancel());
  return (
    <ConfirmDialog
      open={open}
      title="Import preset"
      confirmLabel={applyNow && canApply ? "Import and apply" : "Import"}
      confirmDisabled={!draft}
      onCancel={close}
      onConfirm={() => {
        if (!draft) return;
        onImport(draft, applyNow && canApply);
        setText("");
      }}
    >
      <label className="block">
        <span className="mb-1 block text-muted">Name (used for AutoEQ text)</span>
        <input className="w-full rounded-md border border-line bg-bg px-2 py-1" value={name} maxLength={64} onChange={(e) => setName(e.currentTarget.value)} />
      </label>
      <label className="block">
        <span className="mb-1 block text-muted">Paste AutoEQ "ParametricEQ.txt" or a Tunewright preset JSON</span>
        <textarea
          className="h-40 w-full rounded-md border border-line bg-bg p-2 font-mono text-xs"
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          placeholder={"Preamp: -6.2 dB\nFilter 1: ON LSC Fc 105 Hz Gain 5.5 dB Q 0.71"}
        />
      </label>
      {error && <p className="text-danger">{error}</p>}
      {draft && (
        <div className="rounded-md bg-surface-2 p-2">
          <p>
            “{draft.preset.name}” · {draft.preset.bands.length} bands · preamp {draft.preset.preamp} dB
          </p>
          {draft.preampLowered && <p className="text-warn">Preamp lowered to {draft.preset.preamp} dB so the EQ cannot clip.</p>}
          {draft.skippedLines.length > 0 && <p className="text-muted">Skipped {draft.skippedLines.length} unrecognized line(s).</p>}
        </div>
      )}
      <label className="flex items-center gap-2">
        <input type="checkbox" className="accent-accent" disabled={!canApply} checked={applyNow && canApply} onChange={(e) => setApplyNow(e.currentTarget.checked)} />
        Apply to the DAC now{!canApply && " (connect the DAC first)"}
      </label>
      {applyNow && canApply && <p className="text-warn">Turn the volume down before applying an unfamiliar preset.</p>}
    </ConfirmDialog>
  );
}
