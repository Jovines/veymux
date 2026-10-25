/** A retained workspace can stay mounted while its DOM or enclosing frame is
 * hidden/inert. Such a target must never receive programmatic focus. */
export function isFocusTargetAvailable(target: HTMLElement | null | undefined): target is HTMLElement {
  if (!target?.isConnected || target.matches(':disabled, [aria-disabled="true"]')) return false;
  let node: Element | null = target;
  while (node) {
    if (node.matches('[hidden], [inert], [aria-hidden="true"]')) return false;
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return false;
    if (node.parentElement) node = node.parentElement;
    else {
      try { node = node.ownerDocument.defaultView?.frameElement ?? null; }
      catch { return false; }
    }
  }
  return true;
}

export function hasUnclaimedFocus(doc: Document = document): boolean {
  const active = doc.activeElement;
  return !doc.hidden && doc.hasFocus() && (!active || active === doc.body || active === doc.documentElement);
}

/** Delayed cleanup/initialization may restore only unclaimed focus, or focus
 * still inside the control being removed. A newer button, iframe or editor wins. */
export function canRestoreFocus(target: HTMLElement | null | undefined, departing?: Element | null): target is HTMLElement {
  if (!isFocusTargetAvailable(target)) return false;
  const doc = target.ownerDocument;
  if (doc.hidden || !doc.hasFocus()) return false;
  const active = doc.activeElement;
  return !active || active === doc.body || active === doc.documentElement || active === target || !!departing?.contains(active);
}

export function restoreFocusIfUnclaimed(target: HTMLElement | null | undefined, departing?: Element | null): void {
  if (canRestoreFocus(target, departing) && target.ownerDocument.activeElement !== target) target.focus({ preventScroll: true });
}
