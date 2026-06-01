import { useMemo, useEffect } from 'react';

/**
 * Ambient animated background — theme-accent-coded, GPU-only, pointer-events-none.
 *
 * Layers (back → front):
 *   1. Aurora gradient wash       — slow drifting radial gradients in the accent colour
 *   2. Four blurred floating orbs — large, soft, parallax-style drift
 *   3. Rising particle dots       — small glints floating upward with horizontal drift
 *   4. Dot-grid + vignette mask   — faint structural texture, faded at the edges
 *
 * All colours read from the live CSS accent variables (`--accent-rgb`, etc.), so the
 * whole field recolours instantly when the user picks a different accent preset.
 *
 * Performance: every animation is transform/opacity only (compositor-friendly),
 * particle count drops on small screens, and `prefers-reduced-motion` freezes motion.
 */
export default function AnimatedBackground() {
  const dots = useMemo(() => {
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
    const count = isMobile ? 9 : 20;
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      left: Math.random() * 100,                 // vw start position
      size: 2 + Math.random() * 4,               // px
      delay: Math.random() * -28,                // negative → staggered, already mid-flight
      duration: 16 + Math.random() * 20,         // s
      drift: (Math.random() - 0.5) * 90,         // px horizontal sway
      opacity: 0.18 + Math.random() * 0.4,
    }));
  }, []);

  return (
    <div className="kk-bg" aria-hidden="true">
      <div className="kk-bg-aurora" />
      <div className="kk-orb kk-orb-1" />
      <div className="kk-orb kk-orb-2" />
      <div className="kk-orb kk-orb-3" />
      <div className="kk-orb kk-orb-4 kk-orb-extra" />
      <div className="kk-dots">
        {dots.map(d => (
          <span
            key={d.id}
            className="kk-dot"
            style={{
              left: `${d.left}%`,
              width: `${d.size}px`,
              height: `${d.size}px`,
              animationDelay: `${d.delay}s`,
              animationDuration: `${d.duration}s`,
              '--drift': `${d.drift}px`,
              '--dot-opacity': d.opacity,
            } as React.CSSProperties}
          />
        ))}
      </div>
      <div className="kk-bg-grid" />
    </div>
  );
}
