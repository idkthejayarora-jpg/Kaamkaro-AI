/**
 * Select — custom glass-UI dropdown. Apple-style frosted panel.
 *
 * Click-outside: panel onMouseDown stops propagation so the document
 * listener only fires for true outside clicks.
 * Scroll: wheel/touch events on the panel are stopped from reaching the page.
 */
import { useState, useRef, useLayoutEffect, useEffect, useCallback } from 'react';
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

interface SelectProps {
  value?: string;
  defaultValue?: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}

export default function Select({ value, defaultValue, onChange, children, className = '', disabled }: SelectProps) {
  const isControlled = value !== undefined;
  const [internal, setInternal] = useState(defaultValue ?? '');
  const active = isControlled ? value! : internal;

  const [open,    setOpen]    = useState(false);
  const [closing, setClosing] = useState(false);
  const [pos,     setPos]     = useState<React.CSSProperties>({});
  const [openUp,  setOpenUp]  = useState(false);

  const btnRef   = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const timer    = useRef<ReturnType<typeof setTimeout>>();

  const opts          = parseOptions(children);
  const selectedLabel = opts.find(o => o.value === active)?.label ?? active;

  // ── Animated close ────────────────────────────────────────────────────────
  const closeMenu = useCallback(() => {
    setClosing(true);
    timer.current = setTimeout(() => { setOpen(false); setClosing(false); }, 180);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  // ── Position ──────────────────────────────────────────────────────────────
  const reposition = useCallback(() => {
    if (!btnRef.current) return;
    const r     = btnRef.current.getBoundingClientRect();
    const dropH = Math.min(opts.length * 44 + 16, 300);
    const up    = window.innerHeight - r.bottom < dropH && r.top > dropH;
    setOpenUp(up);
    setPos({
      position : 'fixed',
      zIndex   : 9999,
      left     : r.left,
      width    : Math.max(r.width, 200),
      ...(up ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }),
    });
  }, [opts.length]);

  useLayoutEffect(() => { if (open) reposition(); }, [open, reposition]);

  // ── Close on scroll / resize behind the panel ─────────────────────────────
  useEffect(() => {
    if (!open) return;
    const close = () => closeMenu();
    window.addEventListener('resize', close);
    return () => window.removeEventListener('resize', close);
  }, [open, closeMenu]);

  // ── Close on outside mousedown ────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return;
      closeMenu();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, closeMenu]);

  // ── Pick option ───────────────────────────────────────────────────────────
  const pick = (v: string) => {
    onChange({ target: { value: v } } as React.ChangeEvent<HTMLSelectElement>);
    if (!isControlled) setInternal(defaultValue ?? '');
    closeMenu();
  };

  let lastGroup: string | undefined;

  return (
    <>
      {/* ── Trigger ── */}
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={() => { if (disabled) return; open ? closeMenu() : setOpen(true); }}
        className={`flex items-center justify-between gap-2 text-left ${className} ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span className={`truncate flex-1 ${selectedLabel ? '' : 'text-white/30'}`}>
          {selectedLabel || 'Select…'}
        </span>
        <ChevronDown
          size={13}
          className={`flex-shrink-0 text-white/40 transition-transform duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* ── Floating glass panel ── */}
      {open && createPortal(
        <div
          ref={panelRef}
          style={{
            ...pos,
            transformOrigin: openUp ? 'bottom center' : 'top center',
            animation: closing
              ? 'selectOut 0.18s cubic-bezier(0.4,0,1,1) forwards'
              : 'selectIn 0.22s cubic-bezier(0.16,1,0.3,1) forwards',
          }}
          onMouseDown={e => e.stopPropagation()}
          onWheel={e => e.stopPropagation()}
          onTouchMove={e => e.stopPropagation()}
        >
          {/* Glass layer */}
          <div
            style={{
              background      : 'rgba(28, 28, 30, 0.82)',
              backdropFilter  : 'blur(24px) saturate(180%)',
              WebkitBackdropFilter: 'blur(24px) saturate(180%)',
              border          : '1px solid rgba(255,255,255,0.10)',
              borderRadius    : 16,
              boxShadow       : '0 8px 32px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.06) inset',
              overflow        : 'hidden',
            }}
          >
            {/* Scrollable list */}
            <div
              style={{ maxHeight: 292, overflowY: 'auto', padding: '6px 0' }}
              className="scrollbar-hide"
            >
              {opts.map((opt, i) => {
                const showGroup = opt.group && opt.group !== lastGroup;
                if (showGroup) lastGroup = opt.group;
                const isActive = opt.value === active;
                return (
                  <div key={`${opt.value}__${i}`}>
                    {showGroup && (
                      <p
                        style={{ padding: '10px 14px 4px', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', userSelect: 'none' }}
                      >
                        {opt.group}
                      </p>
                    )}
                    <button
                      type="button"
                      disabled={opt.disabled}
                      onClick={() => !opt.disabled && pick(opt.value)}
                      style={{
                        width           : '100%',
                        display         : 'flex',
                        alignItems      : 'center',
                        justifyContent  : 'space-between',
                        gap             : 10,
                        padding         : '10px 14px',
                        fontSize        : 14,
                        textAlign       : 'left',
                        cursor          : opt.disabled ? 'not-allowed' : 'pointer',
                        color           : opt.disabled ? 'rgba(255,255,255,0.2)'
                                        : isActive     ? '#D4AF37'
                                        :                'rgba(255,255,255,0.75)',
                        background      : isActive ? 'rgba(212,175,55,0.10)' : 'transparent',
                        fontWeight      : isActive ? 500 : 400,
                        transition      : 'background 0.12s ease, color 0.12s ease',
                        border          : 'none',
                        outline         : 'none',
                      }}
                      onMouseEnter={e => {
                        if (!opt.disabled && !isActive)
                          (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)';
                      }}
                      onMouseLeave={e => {
                        if (!isActive)
                          (e.currentTarget as HTMLButtonElement).style.background = isActive ? 'rgba(212,175,55,0.10)' : 'transparent';
                      }}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {opt.label}
                      </span>
                      {isActive && <Check size={12} style={{ color: '#D4AF37', flexShrink: 0 }} />}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
