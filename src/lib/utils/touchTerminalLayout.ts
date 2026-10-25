import { viewportWindow } from '../services/workspaceViewport';

export function isIOSDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** Phone-only UI must not infer the device from a narrow or touch viewport. */
export function isPhoneDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const device = viewportWindow().navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  return /iPhone|iPod/.test(device.userAgent) || /Android.*Mobile/.test(device.userAgent)
    || device.userAgentData?.mobile === true;
}

/** Terminal input follows device capabilities independently of sidebar width. */
export function usesTouchTerminalLayout(): boolean {
  if (typeof window === 'undefined') return false;
  const owner = viewportWindow();
  const hasTouch = owner.navigator.maxTouchPoints > 0 || 'ontouchstart' in owner;
  return isIOSDevice() || (hasTouch && Math.min(owner.innerWidth, owner.innerHeight) < 768);
}
