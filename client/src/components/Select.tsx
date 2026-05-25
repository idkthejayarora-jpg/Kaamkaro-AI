/**
 * Select — fully custom dropdown, no native <select>, no browser chrome.
 *
 * How click-outside works (the tricky part):
 *   • Panel div has onMouseDown={e => e.stopPropagation()}
 *   • Document mousedown listener (bubble phase) only sees clicks that
 *     were NOT inside the panel, so it closes on true outside clicks.
 *   • Option buttons use onClick normally — they fire AFTER mousedown,
 *     so the panel is still open when they fire.
 */
import { useState, useRef, useLayoutEffect, useEffect, useCallback, useId } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { createPortal } from 'react-dom';
import React from 'react';

// ── Parse <option> / <optgroup> children ─────────────────────────────────────
interface Opt { value: string; label: string; disabled?: boolean; group?: string }

function parseOptions(children: React.ReactNode): Opt[] {
  const opts: Opt[] = [];
  React.Children.forEach(children, child => {
    if (!React.isValidElement(child)) return;
    if (child.type === 'option') {
      const p = child.props as { value?: string | number; children?: React.ReactNode; disabled?: boolean };
      opts.push({ value: String(p.value ?? ''), label: String(p.children ?? p.value ?? ''), disabled: p.disabled });
    } else if (child.type === 'optgroup') {
      const g = child.props as { label?: string; children?: React.ReactNode };
      React.Children.forEach(g.children, sub => {
        if (!React.isValidElement(sub) || sub.type !== 'option') return;
        const p = sub.props as { value?: string | number; children?: React.ReactNode; disabled?: boolean };
        opts.push({ value: String(p.value ?? ''), label: String(p.children ?? p.value ?? ''), disabled: p.disabled, group: g.label });
      });
    }
  });
  return opts;
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface SelectProps {
  value?: string;
  defaultValue?: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function Select({ value, defaultValue, onChange, children, className = '', disabled }: SelectProps) {
  const isControlled  = value !== undefined;
  const [internal, setInternal] = useState(defaultValue ?? '');
  const active        = isControlled ? value! : internal;

  const [open, setOpen]         = useState(false);
  const [closing, setClosing]   = useState(false);
  const [style, setStyle]       = useState<React.CSSProperties>({});
  const btnRef                  = useRef<HTMLButtonElement>(null);
  const closeTimer              = useRef<ReturnType<typeof setTimeout>>();

  // Animated close — play out animation then unmount
  const close = useCallback(() => {
    setClosing(true);
    closeTimer.current = setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 160);
  }, []);

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const opts          = parseOptions(children);
  const selectedLabel = opts.find(o => o.value === active)?.label ?? active;

  // ── Position panel below (or above) trigger ───────────────────────────────
  const reposition = useCallback(() => {
    if (!btnRef.current) return;
    const r      = btnRef.current.getBoundingClientRect();
    const dropH  = Math.min(opts.length * 40 + 12, 272);
    const below  = window.innerHeight - r.bottom;
    const openUp = below < dropH && r.top > dropH;
    setStyle({
      position : 'fixed',
      zIndex   : 9999,
      left     : r.left,
      width    : Math.max(r.width, 192),
      ...(openUp ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
    });
  }, [opts.length]);

  useLayoutEffect(() => { if (open) reposition(); }, [open, reposition]);

  // ── Close on scroll / resize ──────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const onScroll = () => close();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => { window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', onScroll); };
  }, [open, close]);

  // ── Close when mousedown happens OUTSIDE both trigger and panel ───────────
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return;
      close();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, close]);

  // ── Select an option ──────────────────────────────────────────────────────
  const pick = (v: string) => {
    onChange({ target: { value: v } } as React.ChangeEvent<HTMLSelectElement>);
    if (!isControlled) setInternal(defaultValue ?? '');
    close();
  };

  // ── Render ────────────────────────────────────────────────────────────────
  let lastGroup: string | undefined;

  return (
    <>
      {/* Trigger */}
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={() => { if (disabled) return; open ? close() : setOpen(true); }}
        className={`flex items-center justify-between gap-2 text-left ${className} ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span className={`truncate flex-1 ${selectedLabel ? 'text-white' : 'text-white/30'}`}>
          {selectedLabel || 'Select…'}
        </span>
        <ChevronDown
          size={14}
          className={`flex-shrink-0 text-white/40 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Dropdown panel — portalled so it's never clipped */}
      {open && createPortal(
        <div
          style={style}
          // stopPropagation on mousedown so the document handler above
          // doesn't see clicks inside the panel and close it prematurely
          onMouseDown={e => e.stopPropagation()}
          className="bg-dark-200 border border-white/10 rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.6)] overflow-hidden"
        >
          <div className="overflow-y-auto py-1.5" style={{ maxHeight: 272 }}>
            {opts.map((opt, i) => {
              const showGroup = opt.group && opt.group !== lastGroup;
              if (showGroup) lastGroup = opt.group;
              return (
                <div key={`${opt.value}__${i}`}>
                  {showGroup && (
                    <p className="px-4 pt-2.5 pb-1 text-[10px] uppercase tracking-widest font-semibold text-white/25 select-none">
                      {opt.group}
                    </p>
                  )}
                  <button
                    type="button"
                    disabled={opt.disabled}
                    onClick={() => !opt.disabled && pick(opt.value)}
                    className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 text-sm text-left transition-colors duration-100
                      ${opt.disabled
                        ? 'text-white/20 cursor-not-allowed'
                        : opt.value === active
                        ? 'text-gold bg-gold/8 font-medium'
                        : 'text-white/65 hover:bg-white/[0.05] hover:text-white'
                      }`}
                  >
                    <span className="truncate">{opt.label}</span>
                    {opt.value === active && <Check size={12} className="text-gold flex-shrink-0" />}
                  </button>
                </div>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
