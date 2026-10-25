/** Keep programmatic opens and App's responsive layout on the same breakpoint. */
export const RIGHT_SIDEBAR_MIN_WIDTH_PX = 320;
export const TERMINAL_WORKSPACE_MIN_WIDTH_PX = 280;
export const PINNED_SIDEBAR_SEPARATOR_WIDTH_PX = 5;

export const DESKTOP_SIDEBAR_QUERY = '(min-width: 1024px)';

export function isDesktopSidebarLayout(): boolean {
  return typeof window === 'undefined' || window.matchMedia?.(DESKTOP_SIDEBAR_QUERY).matches === true;
}

/** Preserve a usable main workspace when both desktop panels are open. */
export function clampDesktopLeftSidebarWidth(width: number, viewportWidth: number, rightOpen: boolean): number {
  const available = viewportWidth - TERMINAL_WORKSPACE_MIN_WIDTH_PX
    - (rightOpen ? RIGHT_SIDEBAR_MIN_WIDTH_PX + PINNED_SIDEBAR_SEPARATOR_WIDTH_PX * 2 : PINNED_SIDEBAR_SEPARATOR_WIDTH_PX);
  return Math.min(Math.max(200, Math.min(500, available)), Math.max(200, width));
}
