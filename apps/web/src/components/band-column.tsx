/** One band as a vertical strip: type, gain slider, gain, frequency and Q. */
import { enabledFilterTypes, TP35_PRO_PROFILE, type FilterSpec, type FilterType } from "@tunewright/walkplay-protocol";
import type { CSSProperties } from "react";
import { SelectField } from "./glass-select-field.tsx";
import { GlassSlider } from "./glassyui/glass-slider.tsx";
import { NumberField } from "./ui-primitives.tsx";

const TYPE_LABELS: Record<FilterType, string> = { PK: "PK", LSQ: "LS", HSQ: "HS", LP: "LP", HP: "HP" };
const TYPES = [...enabledFilterTypes(TP35_PRO_PROFILE)];
const { freqRange, qRange, gainRange } = TP35_PRO_PROFILE;

interface Props {
  index: number;
  band: FilterSpec;
  selected: boolean;
  disabled: boolean;
  onSelect(): void;
  onChange(patch: Partial<FilterSpec>): void;
}

/** Fills the gain track from 0 dB to the value instead of from the bottom, since gain is bipolar. */
function centeredFill(gain: number): CSSProperties {
  const t = (Math.max(gainRange[0], Math.min(gainRange[1], gain)) - gainRange[0]) / (gainRange[1] - gainRange[0]);
  const [top, bottom] = t >= 0.5 ? [(1 - t) * 100, 50] : [50, t * 100];
  return { "--fill-top": `${top}%`, "--fill-bottom": `${bottom}%` } as CSSProperties;
}

export function BandColumn({ index, band, selected, disabled, onSelect, onChange }: Props) {
  const n = index + 1;
  const isPass = band.type === "LP" || band.type === "HP";
  const tone = band.gain > 0 ? "text-accent" : band.gain < 0 ? "text-warn" : "";
  return (
    <div
      onPointerDown={onSelect}
      onFocus={onSelect}
      className={`flex min-h-0 min-w-0 flex-col items-stretch gap-1.5 rounded-xl p-1.5 ring-1 transition ${selected ? "bg-accent-soft ring-accent/50" : "ring-transparent hover:bg-surface/50"}`}
    >
      <span className={`text-center text-[11px] font-semibold ${selected ? "text-accent" : "text-muted"}`}>{n}</span>
      <SelectField<FilterType>
        compact
        label={`Band ${n} type`}
        value={band.type}
        disabled={disabled}
        onChange={(type) => onChange({ type })}
        options={[
          ...(TYPES.includes(band.type) ? [] : [{ value: band.type, label: `${TYPE_LABELS[band.type]} (unsupported)`, disabled: true }]),
          ...TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] })),
        ]}
      />
      <div
        className="relative flex min-h-16 flex-1 justify-center py-1 [&_.lg-slider-range]:top-(--fill-top)! [&_.lg-slider-range]:bottom-(--fill-bottom)!"
        style={centeredFill(band.gain)}
      >
        <span className="pointer-events-none absolute top-1/2 left-1/2 h-px w-5 -translate-x-1/2 bg-muted/60" aria-hidden />
        <GlassSlider
          orientation="vertical"
          className="h-full [--lg-slider-thumb-height:1.375rem] [--lg-slider-thumb-width:1rem] [--lg-slider-track-size:0.3125rem]"
          aria-label={`Band ${n} gain`}
          min={gainRange[0]}
          max={gainRange[1]}
          step={0.1}
          disabled={disabled || isPass}
          value={[Math.max(gainRange[0], Math.min(gainRange[1], band.gain))]}
          onValueChange={([gain]) => gain !== undefined && onChange({ gain: Math.round(gain * 10) / 10 })}
        />
      </div>
      <NumberField compact className={tone} label={`Band ${n} gain (dB)`} value={band.gain} min={gainRange[0]} max={gainRange[1]} precision={1} disabled={disabled || isPass} onCommit={(gain) => onChange({ gain })} />
      <NumberField compact label={`Band ${n} frequency (Hz)`} value={band.freq} min={freqRange[0]} max={freqRange[1]} precision={0} disabled={disabled} onCommit={(freq) => onChange({ freq: Math.round(freq) })} />
      <NumberField compact label={`Band ${n} Q`} value={band.q} min={qRange[0]} max={qRange[1]} disabled={disabled} onCommit={(q) => onChange({ q })} />
    </div>
  );
}
