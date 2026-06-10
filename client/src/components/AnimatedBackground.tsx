/**
 * Ambient background — theme-accent-coded, pointer-events-none, fully static.
 *
 * Apple-style restraint: the old version ran continuously-animated orbs and
 * rising particles, which forced every backdrop-filter surface to re-composite
 * each frame. Now it's just two static layers:
 *   1. Aurora gradient wash     — soft radial gradients in the accent colour
 *   2. Dot-grid + vignette mask — faint structural texture, faded at the edges
 *
 * Colours read from the live CSS accent variables (`--accent-rgb`, etc.), so
 * the field recolours instantly when the user picks a different accent preset.
 */
export default function AnimatedBackground() {
  return (
    <div className="kk-bg" aria-hidden="true">
      <div className="kk-bg-aurora" />
      <div className="kk-bg-grid" />
    </div>
  );
}
