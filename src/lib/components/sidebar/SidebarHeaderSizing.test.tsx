// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Terminal } from 'lucide-react';
import { I18nProvider } from '../../i18n';
import { SidebarHeader } from './SidebarHeader';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('settles a rounded header measurement and keeps responding to wider and narrower layouts', () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ locale: 'en' }))));
  const nativeStyle = window.getComputedStyle;
  vi.stubGlobal('getComputedStyle', (element: Element) => {
    const style = nativeStyle(element);
    if (element.hasAttribute('data-session-sidebar-header')) {
      style.paddingLeft = '12px'; style.paddingRight = '12px';
    }
    return style;
  });
  let width = 334;
  let measurements = 0;
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute('data-session-sidebar-header')) { measurements++; return width; }
    return 0;
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 36 } as DOMRect);
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
    // The full action row leaves a slightly different fractional text width.
    if (this.textContent === 'Sessions') return document.querySelector('[aria-label="Action 0"]') ? 49 : 48;
    return 6;
  });
  render(<I18nProvider><SidebarHeader label="Sessions" count={7}
    actions={Array.from({ length: 4 }, (_, i) => ({ label: `Action ${i}`, icon: Terminal, onSelect: vi.fn() }))}
    recoveryAction={<button>Recoverable sessions</button>}
    onClose={vi.fn()} onOpenSettings={vi.fn()} serverAttention={false} /></I18nProvider>);
  expect(measurements).toBeLessThan(5);
  expect(screen.queryByRole('button', { name: 'Action 0' })).toBeNull();
  width = 500;
  act(() => window.dispatchEvent(new Event('resize')));
  expect(screen.getByRole('button', { name: 'Action 0' })).toBeTruthy();
  width = 328;
  act(() => window.dispatchEvent(new Event('resize')));
  expect(screen.queryByRole('button', { name: 'Action 0' })).toBeNull();
  width = 334;
  act(() => window.dispatchEvent(new Event('resize')));
  expect(screen.queryByRole('button', { name: 'Action 0' })).toBeNull();
  expect(measurements).toBeLessThan(10);
});
