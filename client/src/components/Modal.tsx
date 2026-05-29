/**
 * Modal — portal-based overlay that always renders into document.body.
 *
 * Why this matters: the page wrapper uses `animate-fade-in-up` with
 * `animation-fill-mode: both`, which permanently applies
 * `transform: translateY(0)` and creates a new CSS containing block.
 * Any `position: fixed` child inside that wrapper is positioned relative
 * to the wrapper, not the viewport — causing modals to appear at the
 * bottom of the scroll container instead of over the screen.
 *
 * By portalling into document.body we bypass all CSS transforms entirely.
 */
import { createPortal } from 'react-dom';
import { useEffect } from 'react';
import type { ReactNode } from 'react';

interface ModalProps {
  onClose: () => void;
  children: ReactNode;
  /** Extra classes on the inner card — e.g. max-w-lg, max-w-2xl */
  className?: string;
  /** Prevent clicking the backdrop from closing (default: false) */
  disableBackdropClose?: boolean;
}

export default function Modal({
  onClose,
  children,
  className = 'max-w-md',
  disableBackdropClose = false,
}: ModalProps) {
  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-end sm:items-center justify-center sm:p-4 animate-fade-in"
      onClick={disableBackdropClose ? undefined : onClose}
    >
      <div
        className={`glass-panel rounded-t-2xl sm:rounded-2xl w-full animate-slide-up sm:animate-scale-in max-h-[92vh] flex flex-col ${className}`}
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
