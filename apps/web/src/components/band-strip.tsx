/** All bands side by side with row labels, sized to fill the remaining height. */
import type { DeviceEqState, FilterSpec } from "@tunewright/walkplay-protocol";
import { BandColumn } from "./band-column.tsx";

interface Props {
  eq: DeviceEqState;
  selectedBand: number;
  disabled: boolean;
  onSelect(index: number): void;
  onChange(index: number, patch: Partial<FilterSpec>): void;
}

const ROW = "flex h-7 items-center";

export function BandStrip({ eq, selectedBand, disabled, onSelect, onChange }: Props) {
  return (
    <div className="flex min-h-0 flex-1 gap-1" role="group" aria-label="Bands">
      <div className="flex w-11 shrink-0 flex-col gap-1.5 py-1.5 text-[11px] text-muted" aria-hidden>
        <span className="h-[16.5px]" />
        <span className={ROW}>Type</span>
        <span className="flex flex-1 items-center">Gain</span>
        <span className={ROW}>dB</span>
        <span className={ROW}>Hz</span>
        <span className={ROW}>Q</span>
      </div>
      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-10 gap-1">
        {eq.bands.map((band, i) => (
          <BandColumn
            key={i}
            index={i}
            band={band}
            selected={i === selectedBand}
            disabled={disabled}
            onSelect={() => onSelect(i)}
            onChange={(patch) => onChange(i, patch)}
          />
        ))}
      </div>
    </div>
  );
}
