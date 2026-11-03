import { useState } from "react";
import { FILTER_MODES, type FilterMode } from "@tunewright/walkplay-protocol";
import { useShallow } from "zustand/react/shallow";
import { useDeviceStore } from "../state/device-store.ts";
import { ConfirmDialog } from "./confirm-dialog.tsx";
import { SelectField } from "./glass-select-field.tsx";
import { GlassSwitch } from "./glassyui/glass-switch.tsx";
import { Button, Panel } from "./ui-primitives.tsx";

export function UtilityControlsPanel() {
  const { filterMode, highGain, status, busy, setFilterMode, setHighGain, restoreDefaults } = useDeviceStore(
    useShallow((s) => ({
      filterMode: s.filterMode,
      highGain: s.highGain,
      status: s.status,
      busy: s.busy,
      setFilterMode: s.setFilterMode,
      setHighGain: s.setHighGain,
      restoreDefaults: s.restoreDefaults,
    })),
  );
  const [confirming, setConfirming] = useState(false);
  const disabled = status !== "ready" || busy;
  return (
    <Panel title="DAC">
      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span>Digital filter</span>
          <div className="w-28">
            <SelectField<FilterMode>
              compact
              label="Digital filter"
              value={filterMode}
              placeholder="Unknown"
              disabled={disabled}
              onChange={(m) => void setFilterMode(m)}
              options={FILTER_MODES.map((m) => ({ value: m, label: m }))}
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>High gain</span>
          <GlassSwitch aria-label="High gain" checked={highGain ?? false} disabled={disabled} onCheckedChange={(v) => void setHighGain(v)} />
        </div>
        <Button variant="danger" className="w-full justify-center" disabled={disabled} onClick={() => setConfirming(true)}>
          Restore DAC defaults
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        title="Restore DAC defaults?"
        confirmLabel="Restore"
        danger
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          void restoreDefaults();
        }}
      >
        <p>This resets the digital filter, amp mode and balance, and reloads the EQ saved in the DAC. Unsaved edits are lost.</p>
      </ConfirmDialog>
    </Panel>
  );
}
