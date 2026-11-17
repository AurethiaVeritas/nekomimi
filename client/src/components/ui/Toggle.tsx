import type { KeyboardEvent, ReactNode } from 'react';

type ToggleProps = {
  checked: boolean;
  onChange?: (value: boolean) => void;
  label?: ReactNode;
};

export default function Toggle({ checked, onChange, label }: ToggleProps) {
  const toggle = () => onChange?.(!checked);
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      toggle();
    }
  };
  return (
    <button
      type="button"
      className={`tgl ${checked ? 'is-on' : ''}`}
      role="switch"
      aria-checked={!!checked}
      onClick={toggle}
      onKeyDown={onKeyDown}
    >
      <span className="tgl__track">
        <span className="tgl__knob" />
      </span>
      {label ? <span className="tgl__label">{label}</span> : null}
    </button>
  )
}
