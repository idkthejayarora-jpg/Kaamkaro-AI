/**
 * Select — custom styled dropdown that replaces native <select> elements.
 * Renders via Portal so it's never clipped by overflow containers.
 * Drop-in replacement: same value / onChange / children (<option>) API.
 */
import { useState, useRef, useLayoutEffect, useEffect, useCallback } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { createPortal } from 'react-dom';
import React from 'react';

interface OptionData {
  value: string;
  label: string;
  disabled?: boolean;
  group?: string;
}

function parseOptions(children: React.ReactNode): OptionData[] {
  const opts: OptionData[] = [];
  React.Children.forEach(children, child => {
    if (!React.isValidElement(child)) return;
    if (child.type === 'option') {
      const p = child.props as { value?: string | number; children?: React.ReactNode; disabled?: boolean };
      opts.push({
        value:    String(p.value ?? ''),
        label:    String(p.children ?? p.value ?? ''),
        disabled: p.disabled,
      });
    } else if (child.type === 'optgroup') {
      const gp = child.props as { label?: string; children?: React.ReactNode };
      React.Children.forEach(gp.children, sub => {
        if (!React.isValidElement(sub) || sub.type !== 'option') return;
        const p = sub.props as { value?: string | number; children?: React.ReactNode; disabled?: boolean };
        opts.push({
          value:    String(p.value ?? ''),
          label:    String(p.children ?? p.value ?? ''),
          disabled: p.disabled,
          group:    gp.label,
        });
      });
    }
  });
  return opts;
}

interface SelectProps {
  value?: string;
  defaultValue?: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}

export default function Select({ value, defaultValue, onChange, children, className = '', disabled }: SelectProps) {
  // Support both controlled (value) and uncontrolled/action (defaultValue) modes
  const isControlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue ?? '');
  const activeValue = isControlled ? value : internalValue;

  const [open,      setOpen]      = useState(false);
  const [dropStyle, setDropStyle] = useState<React.CSSProperties>({});
  const btnRef = useRef<HTMLButtonElement>(null);

  const options      = parseOptions(children);
  const selectedOpt  = options.find(o => o.value === activeValue);
  const selectedLabel = selectedOpt?.label ?? activeValue;

  // ── Position the dropdown below (or above) the button ─────────────────────
  const position = useCallback(() => {
    if (!btnRef.current) return;
    const rect        = btnRef.current.getBoundingClientRect();
    const dropH       = Math.min(options.length * 40 + 8, 288);
    const spaceBelow  = window.innerHeight - rect.bottom - 8;
    const openUpward  = spaceBelow < dropH && rect.top > dropH;

    setDropStyle({
      position: 'fixed',
      left:     rect.left,
      width:    Math.max(rect.width, 180),
      ...(openUpward
        ? { bottom: window.innerHeight - rect.top + 4 }
        : { top:    rect.bottom + 4 }),
    });
  }, [options.length]);

  useLayoutEffect(() => { if (open) position(); }, [open, position]);

  // Close on scroll / resize
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  // Click outside
  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (btnRef.current && !btnRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const select = (v: string) => {
    onChange({ target: { value: v } } as React.ChangeEvent<HTMLSelectElement>);
    setOpen(false);
  };

  // ── Group rendering ────────────────────────────────────────────────────────
  let lastGroup: string | undefined = undefined;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        className={`flex items-center justify-between gap-2 text-left cursor-pointer ${className} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <span className={`truncate ${selectedLabel ? '' : 'text-white/25'}`}>
          {selectedLabel || 'Select…'}
        </span>
        <ChevronDown
          size={14}
          className={`flex-shrink-0 text-white/30 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && createPortal(
        <>
          {/* Invisible backdrop to close on outside click */}
          <div className="fixed inset-0 z-[998]" onClick={() => setOpen(false)} />

          {/* Dropdown panel */}
          <div
            className="z-[999] bg-dark-200 border border-dark-50 rounded-2xl shadow-2xl overflow-hidden"
            style={dropStyle}
          >
            <div className="max-h-72 overflow-y-auto py-1.5">
              {options.map((opt, i) => {
                const showGroupHeader = opt.group && opt.group !== lastGroup;
                if (showGroupHeader) lastGroup = opt.group;
                return (
                  <div key={`${opt.value}-${i}`}>
                    {showGroupHeader && (
                      <p className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-widest text-white/25 font-semibold">
                        {opt.group}
                      </p>
                    )}
                    <button
                      type="button"
                      disabled={opt.disabled}
                      onClick={() => !opt.disabled && select(opt.value)}
                      className={`w-full flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm text-left transition-colors
                        ${opt.disabled
                          ? 'text-white/20 cursor-not-allowed'
                          : opt.value === value
                          ? 'text-gold bg-gold/8 font-medium'
                          : 'text-white/70 hover:bg-white/[0.05] hover:text-white'
                        }`}
                    >
                      <span className="truncate">{opt.label}</span>
                      {opt.value === value && (
                        <Check size={12} className="text-gold flex-shrink-0" />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  );
}
