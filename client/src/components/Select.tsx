/**
 * Select — custom styled dropdown replacing native <select>.
 * Portal-rendered so it's never clipped by overflow containers.
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
      opts.push({ value: String(p.value ?? ''), label: String(p.children ?? p.value ?? ''), disabled: p.disabled });
    } else if (child.type === 'optgroup') {
      const gp = child.props as { label?: string; children?: React.ReactNode };
      React.Children.forEach(gp.children, sub => {
        if (!React.isValidElement(sub) || sub.type !== 'option') return;
        const p = sub.props as { value?: string | number; children?: React.ReactNode; disabled?: boolean };
        opts.push({ value: String(p.value ?? ''), label: String(p.children ?? p.value ?? ''), disabled: p.disabled, group: gp.label });
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
  const isControlled    = value !== undefined;
  const [internal, setInternal] = useState(defaultValue ?? '');
  const activeValue     = isControlled ? value! : internal;

  const [open,      setOpen]      = useState(false);
  const [dropStyle, setDropStyle] = useState<React.CSSProperties>({});
  const btnRef   = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const options       = parseOptions(children);
  const selectedLabel = options.find(o => o.value === activeValue)?.label ?? activeValue;

  // ── Position dropdown below (or above) the trigger button ─────────────────
  const position = useCallback(() => {
    if (!btnRef.current) return;
    const rect       = btnRef.current.getBoundingClientRect();
    const dropH      = Math.min(options.length * 40 + 12, 288);
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const openUp     = spaceBelow < dropH && rect.top > dropH;
    setDropStyle({
      position : 'fixed',
      left     : rect.left,
      width    : Math.max(rect.width, 180),
      zIndex   : 9999,
      ...(openUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
    });
  }, [options.length]);

  useLayoutEffect(() => { if (open) position(); }, [open, position]);

  // Close on scroll or resize
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

  // ── Select an option ───────────────────────────────────────────────────────
  const select = (v: string) => {
    onChange({ target: { value: v } } as React.ChangeEvent<HTMLSelectElement>);
    if (!isControlled) setInternal(defaultValue ?? ''); // reset action-selects
    setOpen(false);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  let lastGroup: string | undefined;

  return (
    <>
      {/* Trigger button — styled identically to .input class */}
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        className={`flex items-center justify-between gap-2 text-left cursor-pointer ${className} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <span className={`truncate flex-1 ${selectedLabel ? '' : 'text-white/25'}`}>
          {selectedLabel || 'Select…'}
        </span>
        <ChevronDown
          size={14}
          className={`flex-shrink-0 text-white/30 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Dropdown — portalled to body */}
      {open && createPortal(
        <>
          {/* Full-screen backdrop — click it to close. z-index just below panel. */}
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
            onMouseDown={() => setOpen(false)}
          />

          {/* Panel */}
          <div
            ref={panelRef}
            style={dropStyle}
            className="bg-dark-200 border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
          >
            <div className="overflow-y-auto py-1.5" style={{ maxHeight: 280 }}>
              {options.map((opt, i) => {
                const showGroup = opt.group && opt.group !== lastGroup;
                if (showGroup) lastGroup = opt.group;
                return (
                  <div key={`${opt.value}-${i}`}>
                    {showGroup && (
                      <p className="px-3.5 pt-2.5 pb-1 text-[10px] uppercase tracking-widest text-white/25 font-semibold select-none">
                        {opt.group}
                      </p>
                    )}
                    <button
                      type="button"
                      disabled={opt.disabled}
                      /* onMouseDown with stopPropagation prevents the backdrop's
                         onMouseDown from firing and closing the panel before onClick */
                      onMouseDown={e => e.stopPropagation()}
                      onClick={() => !opt.disabled && select(opt.value)}
                      className={`w-full flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm text-left transition-colors
                        ${opt.disabled
                          ? 'text-white/20 cursor-not-allowed'
                          : opt.value === activeValue
                          ? 'text-gold bg-gold/8 font-medium'
                          : 'text-white/70 hover:bg-white/[0.06] hover:text-white'
                        }`}
                    >
                      <span className="truncate">{opt.label}</span>
                      {opt.value === activeValue && (
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
