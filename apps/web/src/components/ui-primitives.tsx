/** Thin wrappers over GlassyUI so every panel uses the same controls and spacing. */
import { useRef, useState, type ReactNode } from "react";
import { GlassButton, type ButtonProps } from "./glassyui/glass-button.tsx";
import { GlassInput } from "./glassyui/glass-input.tsx";
import { GlassPanel } from "./glassyui/glass-panel.tsx";

type Variant = "primary" | "secondary" | "danger" | "ghost";
const GLASS_VARIANT = { primary: "prominent", secondary: "soft", danger: "soft", ghost: "ghost" } as const;

export function Button({ variant = "secondary", className = "", ...rest }: Omit<ButtonProps, "variant"> & { variant?: Variant }) {
  return (
    <GlassButton
      size="sm"
      variant={GLASS_VARIANT[variant]}
      className={`${variant === "danger" ? "text-danger" : ""} ${className}`}
      {...rest}
    />
  );
}

export function Panel({
  title,
  actions,
  className = "",
  children,
}: {
  title: string;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <GlassPanel variant="card" className={`flex min-h-0 flex-col p-3 ${className}`}>
      <header className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <h2 className="text-xs font-semibold tracking-wider text-muted uppercase">{title}</h2>
        {actions}
      </header>
      {children}
    </GlassPanel>
  );
}

/**
 * Number input that edits a local draft and commits only on blur or Enter, so
 * intermediate keystrokes (e.g. "2" on the way to "2000") never reach the DAC.
 * Escape or invalid input reverts to the current value.
 */
export function NumberField({
  label,
  value,
  min,
  max,
  disabled,
  precision = 2,
  compact = false,
  className = "",
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  /** Decimal places shown. The wire stores Q and gain in 1/256 steps (0.7 reads back as 0.699…). */
  precision?: number;
  disabled?: boolean;
  /** Small size for dense layouts such as the band strip. */
  compact?: boolean;
  className?: string;
  onCommit(value: number): void;
}) {
  const shown = String(+value.toFixed(precision));
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  const commit = () => {
    // Focus + blur without typing must not "round" the stored value and mark the EQ dirty.
    if (draft === null || cancelled.current || draft === shown) {
      cancelled.current = false;
      setDraft(null);
      return;
    }
    const v = Number(draft.replace(",", "."));
    setDraft(null);
    if (draft.trim() !== "" && Number.isFinite(v)) {
      const clamped = Math.min(max, Math.max(min, v));
      if (clamped !== value) onCommit(clamped);
    }
  };
  return (
    <GlassInput
      type="text"
      inputMode="decimal"
      aria-label={label}
      title={`${min} to ${max}`}
      className={`tabular-nums ${className} ${compact ? "h-7 rounded-lg px-1.5 py-0 text-center text-xs" : "text-right"}`}
      value={draft ?? shown}
      disabled={disabled}
      onFocus={(e) => (setDraft(shown), e.currentTarget.select())}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}
