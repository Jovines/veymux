import { useLayoutEffect, useRef, useSyncExternalStore, type RefObject } from 'react';
import { isWorkspaceActive, WORKSPACE_VISIBILITY_EVENT } from '../services/workspaceHost';
import { isFocusTargetAvailable, restoreFocusIfUnclaimed } from '../utils/focusOwnership';

interface KeyboardLayer { element: HTMLElement }
const layers: KeyboardLayer[] = [];
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const bridgeLayers = new WeakMap<HTMLElement, KeyboardLayer>();
let observer: MutationObserver | undefined;
function observeLayers() {
  if (!observer) return;
  observer.disconnect();
  // Bridge confirmations mount directly in body. Observe only layer ancestors
  // for visibility, rather than every terminal output/text mutation.
  observer.observe(document.body, { childList: true });
  const observed = new Set<HTMLElement>();
  for (const layer of layers) for (let node: HTMLElement | null = layer.element; node; node = node.parentElement) {
    if (observed.has(node)) break;
    observed.add(node);
    observer.observe(node, { childList: node === document.body, attributes: true, attributeFilter: ['hidden', 'inert', 'aria-hidden', 'style', 'class'] });
  }
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    observer = new MutationObserver(notify); observeLayers();
    window.addEventListener(WORKSPACE_VISIBILITY_EVENT, notify);
    document.addEventListener('visibilitychange', notify);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      observer?.disconnect(); observer = undefined;
      window.removeEventListener(WORKSPACE_VISIBILITY_EVENT, notify);
      document.removeEventListener('visibilitychange', notify);
    }
  };
}

function activeKeyboardLayer(departing?: KeyboardLayer): KeyboardLayer | null {
  if (typeof document === 'undefined' || document.hidden || !isWorkspaceActive()) return null;
  const confirmation = document.querySelector<HTMLElement>('[data-desktop-confirmation="true"]');
  if (isFocusTargetAvailable(confirmation)) {
    let layer = bridgeLayers.get(confirmation);
    if (!layer) { layer = { element: confirmation }; bridgeLayers.set(confirmation, layer); }
    return layer;
  }
  return [...layers].reverse().find(layer => layer === departing || isFocusTargetAvailable(layer.element)) ?? null;
}
export const getActiveKeyboardLayer = (): KeyboardLayer | null => activeKeyboardLayer();
export const isKeyboardLayerOpen = () => getActiveKeyboardLayer() !== null;

/** Explicit input actions may belong only to the current, visible keyboard owner. */
export function isKeyboardLayerSource(source: HTMLElement): boolean {
  if (!isWorkspaceActive() || !isFocusTargetAvailable(source)) return false;
  const top = getActiveKeyboardLayer();
  const layerRoots = top ? roots(top.element) : [document.body];
  return source.isConnected && !source.closest('[hidden], [inert], [aria-hidden="true"]')
    && (!top || layerRoots.some(root => root.contains(source))) && visibleInLayer(source, layerRoots);
}
export function useKeyboardLayerOpen(): boolean {
  return useSyncExternalStore(subscribe, isKeyboardLayerOpen, () => false);
}

function roots(element: HTMLElement): HTMLElement[] {
  const portals = Array.from(document.querySelectorAll<HTMLElement>('[data-sidebar-composer-popover]'))
    .filter((portal) => element.id && portal.dataset.sidebarComposerPopover === element.id);
  return [element, ...portals];
}

function visibleInLayer(control: HTMLElement, layerRoots: HTMLElement[]): boolean {
  for (let node: HTMLElement | null = control; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (layerRoots.includes(node)) break;
  }
  return true;
}

function controls(element: HTMLElement): HTMLElement[] {
  const layerRoots = roots(element);
  return layerRoots.flatMap((root) => Array.from(root.querySelectorAll<HTMLElement>(
    'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], summary, iframe, [tabindex]',
  ))).filter((control) => {
    const closedDetails = control.closest('details:not([open])');
    const summary = closedDetails?.querySelector('summary');
    return control.tabIndex >= 0 && !control.matches(':disabled') && !control.closest('[hidden], [inert], [aria-hidden="true"]')
      && (!closedDetails || !!summary?.contains(control))
      && visibleInLayer(control, layerRoots);
  });
}

/** Temporary tasks own keyboard input until their topmost layer closes. */
export function useKeyboardLayer(ref: RefObject<HTMLElement>, open: boolean, onEscape: () => void, restoreFocus?: () => HTMLElement | null): void {
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;
  const restoreRef = useRef(restoreFocus);
  restoreRef.current = restoreFocus;
  useLayoutEffect(() => {
    const element = ref.current;
    if (!open || !element) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const layer = { element };
    // Child layout effects can register before their parent in the same commit.
    // A containing layer belongs beneath its already registered descendants.
    const descendant = layers.findIndex(candidate => element.contains(candidate.element));
    if (descendant < 0) layers.push(layer); else layers.splice(descendant, 0, layer);
    observeLayers();
    notify();
    const isTop = () => getActiveKeyboardLayer() === layer;
    const contains = (target: EventTarget | null) => target instanceof Node && roots(element).some((root) => root.contains(target));
    const focusFirst = () => (controls(element)[0] ?? element).focus({ preventScroll: true });
    if (isTop() && !contains(document.activeElement)) focusFirst();
    const keepFocus = (event: FocusEvent) => {
      if (document.hasFocus() && isTop() && !contains(event.target)) focusFirst();
    };
    const trapTab = (event: KeyboardEvent) => {
      if (!isTop() || event.key !== 'Tab' || event.defaultPrevented) return;
      const items = controls(element);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !contains(document.activeElement)
        || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus({ preventScroll: true });
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (!isTop() || event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      escapeRef.current();
    };
    document.addEventListener('focusin', keepFocus, true);
    document.addEventListener('keydown', trapTab, true);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      // A conditional element in the hook's own component may already have
      // been removed during React's mutation phase. Keep its stack position
      // for cleanup; a visible bridge/child layer still has priority.
      const wasTop = activeKeyboardLayer(element.isConnected ? undefined : layer) === layer;
      layers.splice(layers.indexOf(layer), 1);
      observeLayers();
      notify();
      document.removeEventListener('focusin', keepFocus, true);
      document.removeEventListener('keydown', trapTab, true);
      document.removeEventListener('keydown', closeOnEscape);
      if (wasTop) {
        const remainingTop = getActiveKeyboardLayer();
        // React can remove the original trigger after layout cleanup. Restore
        // after that commit so recreated launch buttons can receive focus.
        queueMicrotask(() => {
          if (getActiveKeyboardLayer() !== remainingTop || !isWorkspaceActive()) return;
          const target = previous?.isConnected && previous !== document.body ? previous : restoreRef.current?.();
          if (target && remainingTop && !roots(remainingTop.element).some(root => root.contains(target))) return;
          restoreFocusIfUnclaimed(target, element);
        });
      }
    };
  }, [open, ref]);
}
