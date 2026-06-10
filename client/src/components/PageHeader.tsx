/**
 * PageHeader — Apple-style Large Title page header.
 * Title left (28px bold, tight tracking), optional subtitle below,
 * actions right-aligned. Use at the top of every page for consistency.
 */
import type { ReactNode } from 'react';

export default function PageHeader({
  title, subtitle, actions, className = '',
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-end justify-between gap-3 flex-wrap ${className}`}>
      <div className="min-w-0">
        <h1 className="kk-large-title text-white truncate">{title}</h1>
        {subtitle && <p className="kk-footnote text-white/45 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  );
}
