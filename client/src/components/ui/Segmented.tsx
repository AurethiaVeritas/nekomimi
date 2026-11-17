import type { ReactNode } from 'react';

type SegmentedOption<Value extends string | number> = {
  value: Value;
  label: ReactNode;
};

type SegmentedProps<Value extends string | number> = {
  value: Value;
  options?: SegmentedOption<Value>[];
  onChange?: (value: Value) => void;
};

/**
 * Segmented – compact set of options; radio-like behavior
 * Props: value, options[{value,label}], onChange
 */
export default function Segmented<Value extends string | number>({ value, options = [], onChange }: SegmentedProps<Value>) {
  const opts = options ?? [];
  return (
    <div className="seg">
      {opts.map(o => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          className={`seg__btn ${o.value === value ? 'is-active' : ''}`}
          onClick={() => onChange?.(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
