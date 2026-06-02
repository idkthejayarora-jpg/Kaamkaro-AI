/**
 * Apple-style success tick — a coloured disc that springs in, with a white
 * checkmark that draws on. Big and legible on a tablet kiosk.
 *
 *   <SuccessTick size={150} color="#22c55e" />
 *
 * Animation is driven by .kk-tick-pop / .kk-tick-draw keyframes in index.css.
 * `key`-remount it (or rely on conditional mount) so it replays each success.
 */
export default function SuccessTick({ size = 140, color = '#22c55e' }: { size?: number; color?: string }) {
  return (
    <div
      className="kk-tick-pop mx-auto flex items-center justify-center rounded-full"
      style={{ width: size, height: size, background: color, boxShadow: `0 14px 44px ${color}55` }}
    >
      <svg viewBox="0 0 52 52" width={size * 0.56} height={size * 0.56} aria-hidden="true">
        <path
          className="kk-tick-draw"
          d="M14 27 l8 8 l16 -18"
          fill="none"
          stroke="#fff"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
