/**
 * Portal — renders children directly into document.body.
 *
 * Fixes the animate-fade-in-up transform containment bug where
 * position:fixed children are trapped inside the page wrapper div
 * instead of being viewport-relative.
 */
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

export default function Portal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}
