/**
 * Select — custom styled dropdown replacing native <select>.
 * Uses a real <select> under the hood for reliability, overlaid with
 * a custom-styled presentation layer. Zero glitches, full keyboard support.
 */
import React, { useId } from 'react';
import { ChevronDown } from 'lucide-react';

interface SelectProps {
  value?: string;
  defaultValue?: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}

export default function Select({
  value,
  defaultValue,
  onChange,
  children,
  className = '',
  disabled,
}: SelectProps) {
  return (
    <div className={`relative inline-flex items-center ${className}`}>
      {/* The real native <select> — invisible but fully functional */}
      <select
        value={value}
        defaultValue={defaultValue}
        onChange={onChange}
        disabled={disabled}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
        style={{ zIndex: 2 }}
      >
        {children}
      </select>

      {/* Visual presentation layer */}
      <div
        className={`flex items-center justify-between gap-2 w-full pointer-events-none
          ${disabled ? 'opacity-50' : ''}`}
      >
        <SelectedLabel value={value} defaultValue={defaultValue}>
          {children}
        </SelectedLabel>
        <ChevronDown size={14} className="flex-shrink-0 text-white/30" />
      </div>
    </div>
  );
}

/** Reads the current value from children <option>s and returns the matching label */
function SelectedLabel({
  value,
  defaultValue,
  children,
}: {
  value?: string;
  defaultValue?: string;
  children: React.ReactNode;
}) {
  const active = value ?? defaultValue ?? '';
  let label = active;

  React.Children.forEach(children, child => {
    if (!React.isValidElement(child)) return;
    if (child.type === 'option') {
      const p = child.props as { value?: string | number; children?: React.ReactNode };
      if (String(p.value ?? '') === active) {
        label = String(p.children ?? p.value ?? '');
      }
    } else if (child.type === 'optgroup') {
      const gp = child.props as { children?: React.ReactNode };
      React.Children.forEach(gp.children, sub => {
        if (!React.isValidElement(sub) || sub.type !== 'option') return;
        const p = sub.props as { value?: string | number; children?: React.ReactNode };
        if (String(p.value ?? '') === active) {
          label = String(p.children ?? p.value ?? '');
        }
      });
    }
  });

  return (
    <span className={`truncate flex-1 text-sm ${label && label !== active ? '' : label ? '' : 'text-white/25'}`}>
      {label || 'Select…'}
    </span>
  );
}
