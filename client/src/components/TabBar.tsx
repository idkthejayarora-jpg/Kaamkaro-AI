import { useRef, useLayoutEffect, useState, useCallback } from 'react';

// ── useTabSlider — measures active button position for sliding indicator ───────
export function useTabSlider(active: string) {
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRefs   = useRef<Map<string, HTMLButtonElement>>(new Map());
  const isFirst      = useRef(true);
  const [sliderStyle, setSliderStyle] = useState<React.CSSProperties>({
    left: 0, width: 0, transition: 'none',
  });

  useLayoutEffect(() => {
    const btn       = buttonRefs.current.get(active);
    const container = containerRef.current;
    if (!btn || !container) return;
    const cRect = container.getBoundingClientRect();
    const bRect = btn.getBoundingClientRect();
    const left  = bRect.left - cRect.left;
    const width = bRect.width;
    if (isFirst.current) {
      setSliderStyle({ left, width, transition: 'none' });
      isFirst.current = false;
    } else {
      setSliderStyle({
        left, width,
        transition: 'left 0.22s cubic-bezier(0.4,0,0.2,1), width 0.22s cubic-bezier(0.4,0,0.2,1)',
      });
    }
  }, [active]);

  const setRef = useCallback((key: string) => (el: HTMLButtonElement | null) => {
    if (el) buttonRefs.current.set(key, el);
    else    buttonRefs.current.delete(key);
  }, []);

  return { containerRef, setRef, sliderStyle };
}

// ── TabBar — pill-style tab bar with sliding background ───────────────────────

interface TabDef {
  id: string;
  label: string;
  icon?: React.ElementType;
  count?: number;
  adminOnly?: boolean;
}

interface TabBarProps {
  tabs: TabDef[];
  active: string;
  onChange: (id: string) => void;
  /** pill-gold = gold pill on dark-400 tray (default)
   *  pill-dark = dark pill on dark-300 tray */
  variant?: 'pill-gold' | 'pill-dark';
  className?: string;
}

export function TabBar({ tabs, active, onChange, variant = 'pill-gold', className = '' }: TabBarProps) {
  const { containerRef, setRef, sliderStyle } = useTabSlider(active);

  const trayClass  = variant === 'pill-gold'
    ? 'bg-dark-400 border border-dark-50 rounded-2xl p-1'
    : 'bg-dark-300 rounded-xl p-1';
  const pillClass  = variant === 'pill-gold' ? 'bg-gold' : 'bg-dark-100';
  const activeText = variant === 'pill-gold' ? 'text-black' : 'text-white';

  return (
    <div ref={containerRef} className={`relative flex gap-1 ${trayClass} ${className}`}>
      {/* Sliding pill — absolutely positioned behind buttons */}
      <div
        className={`absolute top-1 bottom-1 rounded-xl ${pillClass}`}
        style={sliderStyle}
        aria-hidden
      />
      {tabs.map(tab => {
        const Icon     = tab.icon;
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            ref={setRef(tab.id)}
            onClick={() => onChange(tab.id)}
            className={`relative z-10 flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-sm font-medium transition-colors duration-150 ${
              isActive ? activeText : 'text-white/40 hover:text-white'
            }`}
          >
            {Icon && <Icon size={14} />}
            <span className="hidden sm:inline">{tab.label}</span>
            {tab.count !== undefined && tab.count > 0 && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full transition-colors ${
                isActive ? 'bg-black/15' : 'bg-white/8 text-white/30'
              }`}>
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── AnimatedTabPanel — fades + slides content in on tab switch ────────────────
// Usage: wrap tab content with <AnimatedTabPanel key={tab}>...</AnimatedTabPanel>
// The `key` prop (set by the parent) causes React to remount this component on
// tab change, triggering the CSS animation from scratch.
export function AnimatedTabPanel({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`animate-fade-in-up ${className}`}>
      {children}
    </div>
  );
}
