import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';
import { useI18n } from '../../i18n';

/** One meaning everywhere: show or hide a panel, preserving its contents. */
export function SidebarVisibilityButton({ side, expanded, className = '', children, ...props }: {
  side: 'left' | 'right';
  expanded: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const { t } = useI18n();
  const label = t(side === 'left'
    ? expanded ? 'sidebar.collapseSessions' : 'sidebar.expandSessions'
    : expanded ? 'sidebar.collapseTools' : 'sidebar.expandTools');
  const Icon = side === 'left'
    ? expanded ? PanelLeftClose : PanelLeftOpen
    : expanded ? PanelRightClose : PanelRightOpen;
  return <button {...props} type="button" aria-label={label} title={label} aria-expanded={expanded}
    className={`inline-flex shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-surface-elevated hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${className}`}>
    <Icon size={16} />{children}
  </button>;
}
