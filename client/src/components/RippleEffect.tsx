import { useEffect } from 'react';

/**
 * Global touch/click ripple — Material-style, theme-accent-coded.
 *
 * Mounted once at the app root. Listens for `pointerdown` (touch + mouse + pen)
 * and, when the press lands on an interactive element, paints an expanding ripple.
 *
 * Non-invasive by design: instead of mutating the target (no forced position/
 * overflow), it renders a *separate* overlay layer clipped to the target's bounds
 * and border-radius, so no existing component layout is affected. The overlay is
 * `pointer-events: none` and removed as soon as the animation finishes.
 *
 * Performance: Web Animations API (compositor-driven transform/opacity), two
 * throwaway DOM nodes per press, and a hard no-op under `prefers-reduced-motion`.
 */

// Elements that should ripple. Kept specific so we don't ripple whole layout shells.
const RIPPLE_SELECTOR = [
  'button',
  '[role="button"]',
  '.card',
  '.sidebar-link',
  '.btn-primary',
  '.btn-secondary',
  '.btn-ghost',
  '.btn-danger',
  '[data-ripple]',
].join(',');

export default function RippleEffect() {
  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return;

    function spawn(e: PointerEvent) {
      // Only primary button / touch / pen contact
      if (e.button !== undefined && e.button !== 0) return;

      const start = e.target as Element | null;
      if (!start) return;

      // Resolve the nearest rippleable ancestor, bailing on opt-outs / disabled controls
      const el = start.closest<HTMLElement>(RIPPLE_SELECTOR);
      if (!el) return;
      if (el.closest('[data-no-ripple]')) return;
      if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return;
      if (start.closest('input, textarea, select')) return;

      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      // Pointer position relative to the element
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Diameter must reach the farthest corner so the ripple fully covers the element
      const dx = Math.max(x, rect.width - x);
      const dy = Math.max(y, rect.height - y);
      const diameter = 2 * Math.hypot(dx, dy);

      const cs = getComputedStyle(el);

      // Themed colour: white on accent-filled controls, accent elsewhere
      const isFilled =
        el.classList.contains('btn-primary') ||
        el.classList.contains('bg-gold') ||
        el.className.includes('bg-gold');
      const accent = getComputedStyle(document.documentElement)
        .getPropertyValue('--accent-rgb').trim() || '201 168 76';
      const color = isFilled
        ? 'rgba(255,255,255,0.55)'
        : `rgb(${accent} / 0.30)`;

      // Overlay clipped to the element's box + corner radius (no target mutation)
      const overlay = document.createElement('div');
      overlay.style.cssText = `
        position:fixed; left:${rect.left}px; top:${rect.top}px;
        width:${rect.width}px; height:${rect.height}px;
        border-radius:${cs.borderRadius || '0'};
        overflow:hidden; pointer-events:none; z-index:9998;
        contain:strict;`;

      const ripple = document.createElement('span');
      ripple.style.cssText = `
        position:absolute; left:${x}px; top:${y}px;
        width:${diameter}px; height:${diameter}px;
        margin-left:${-diameter / 2}px; margin-top:${-diameter / 2}px;
        border-radius:50%; background:${color};
        transform:scale(0); will-change:transform,opacity;`;

      overlay.appendChild(ripple);
      document.body.appendChild(overlay);

      const anim = ripple.animate(
        [
          { transform: 'scale(0)', opacity: 1 },
          { transform: 'scale(1)', opacity: 0 },
        ],
        { duration: 600, easing: 'cubic-bezier(0.25,0.46,0.45,0.94)' },
      );
      anim.onfinish = () => overlay.remove();
      anim.oncancel = () => overlay.remove();
    }

    document.addEventListener('pointerdown', spawn, { passive: true });
    return () => document.removeEventListener('pointerdown', spawn);
  }, []);

  return null;
}
