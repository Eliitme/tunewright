/** Small wrapper over GlassSelect for plain string options. */
import {
  GlassSelect,
  GlassSelectContent,
  GlassSelectItem,
  GlassSelectTrigger,
  GlassSelectValue,
} from "./glassyui/glass-select.tsx";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  disabled,
  placeholder,
  compact = false,
  onChange,
}: {
  label: string;
  value: T | null;
  options: SelectOption<T>[];
  disabled?: boolean;
  placeholder?: string;
  compact?: boolean;
  onChange(value: T): void;
}) {
  return (
    <GlassSelect value={value ?? undefined} disabled={disabled} onValueChange={(v) => onChange(v as T)}>
      <GlassSelectTrigger aria-label={label} className={`w-full ${compact ? "h-7 gap-0.5 rounded-lg px-1.5 py-0 text-xs" : ""}`}>
        <GlassSelectValue placeholder={placeholder ?? "Select"} />
      </GlassSelectTrigger>
      <GlassSelectContent>
        {options.map((o) => (
          <GlassSelectItem key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </GlassSelectItem>
        ))}
      </GlassSelectContent>
    </GlassSelect>
  );
}
