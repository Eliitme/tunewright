/** Single-screen editor: graph and band strip on the left, output/presets/DAC on the right. */
import { useShallow } from "zustand/react/shallow";
import { useDeviceStore } from "../state/device-store.ts";
import { BandStrip } from "../components/band-strip.tsx";
import { EqGraphCanvas } from "../components/eq-graph-canvas.tsx";
import { PreampControl } from "../components/preamp-control.tsx";
import { PresetSidebar } from "../components/preset-sidebar.tsx";
import { StatusToasts } from "../components/status-toasts.tsx";
import { UtilityControlsPanel } from "../components/utility-controls-panel.tsx";
import { Button, Panel } from "../components/ui-primitives.tsx";

export function EditorPage() {
  const s = useDeviceStore(
    useShallow((st) => ({
      eq: st.eq,
      editable: st.status === "ready" && st.confirmed && !st.busy,
      selectedBand: st.selectedBand,
      selectBand: st.selectBand,
      updateBand: st.updateBand,
      setPreamp: st.setPreamp,
      resetFlat: st.resetFlat,
    })),
  );
  return (
    <main className="grid min-h-0 flex-1 gap-3 overflow-y-auto p-3 lg:grid-cols-[minmax(0,1fr)_300px] lg:overflow-hidden">
      <Panel
        title="Equalizer"
        className="min-h-0"
        actions={
          <Button disabled={!s.editable} onClick={s.resetFlat} title="All bands and preamp to 0 dB (not saved until Save to DAC)">
            Reset
          </Button>
        }
      >
        {s.eq ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="min-h-[140px] flex-[1.1]">
              <EqGraphCanvas eq={s.eq} selectedBand={s.selectedBand} disabled={!s.editable} onSelect={s.selectBand} onChange={s.updateBand} />
            </div>
            <div className="flex min-h-[260px] flex-1">
              <BandStrip eq={s.eq} selectedBand={s.selectedBand} disabled={!s.editable} onSelect={s.selectBand} onChange={s.updateBand} />
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted">Plug in the TP35 Pro and press “Connect TP35 Pro”.</div>
        )}
      </Panel>
      <aside className="flex min-h-0 flex-col gap-3">
        <PreampControl eq={s.eq} disabled={!s.editable} onChange={s.setPreamp} />
        <PresetSidebar />
        <UtilityControlsPanel />
      </aside>
      <StatusToasts />
    </main>
  );
}
