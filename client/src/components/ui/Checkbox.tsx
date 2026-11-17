import type { ReactNode } from 'react';

type CheckboxProps = {
  checked: boolean;
  onChange?: (value: boolean) => void;
  label?: ReactNode;
};

export default function Checkbox({ checked, onChange, label }: CheckboxProps) {
  return (
    <button
      type="button"
      className={`chk ${checked ? 'is-checked' : ''}`}
      role="checkbox"
      aria-checked={!!checked}
      onClick={() => onChange?.(!checked)}
    >
      <span className="chk__box" aria-hidden="true">{checked ? '✓' : ''}</span>
      {label ? <span className="chk__label">{label}</span> : null}
    </button>
  )
}
