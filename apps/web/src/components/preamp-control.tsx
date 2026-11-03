import { safePreamp, TP35_PRO_PROFILE, type DeviceEqState } from "@tunewright/walkplay-protocol";
import { GlassSlider } from "./glassyui/glass-slider.tsx";
import { Button, Panel } from "./ui-primitives.tsx";

const [min, max] = TP35_PRO_PROFILE.preampRange;

export function PreampControl({ eq, disabled, onChange }: { eq: DeviceEqState | null; disabled: boolean; onChange(db: number): void }) {
  const safe = eq ? safePreamp({ ...eq, preamp: max }, TP35_PRO_PROFILE) : null;
  const clipping = !!eq && !!safe && eq.preamp > safe.preamp;
  return (
    <Panel
      title="Preamp"
      actions={<span className="text-sm font-semibold tabular-nums">{eq ? `${eq.preamp} dB` : "—"}</span>}
    >
      <GlassSlider
        aria-label="Preamp"
        min={min}
        max={max}
        step={1}
        value={[eq?.preamp ?? 0]}
        disabled={disabled || !eq}
        onValueChange={([db]) => db !== undefined && onChange(db)}
      />
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className={`text-xs ${clipping ? "text-warn" : "text-muted"}`}>{clipping ? "May clip — lower the preamp" : "No clipping"}</span>
        <Button disabled={disabled || !safe || eq?.preamp === safe.preamp} onClick={() => safe && onChange(safe.preamp)} className="shrink-0 whitespace-nowrap" title="Highest preamp that cannot clip with this EQ">
          Auto{safe ? ` ${safe.preamp} dB` : ""}
        </Button>
      </div>
    </Panel>
  );
}
