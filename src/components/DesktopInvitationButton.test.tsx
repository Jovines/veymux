// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DesktopInvitationButton } from './DesktopInvitationButton';
const invitation={url:'https://entry.example',targetPeerId:'12D3KooW'+'a'.repeat(44),pairingCode:'c'.repeat(43),viewMode:'chat' as const};
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('requests the installed Mac handler explicitly and offers recovery without claiming acceptance',()=>{
  vi.stubGlobal('navigator',{platform:'MacIntel',maxTouchPoints:0});
  render(<DesktopInvitationButton invitation={invitation} />);
  const link=screen.getByRole('link',{name:'在客户端打开'});
  expect(link.getAttribute('href')).toMatch(/^veymux:\/\/invite\/#veymux-invite=/);
  link.addEventListener('click',event=>event.preventDefault());fireEvent.click(link);
  expect(screen.getByRole('link',{name:'安装或更新 Mac 客户端'})).toBeTruthy();
  expect(screen.queryByText(/已添加|已连接|已接受/)).toBeNull();
});
it('keeps the browser flow available on mobile and does not offer spent credentials without an invitation',()=>{
  vi.stubGlobal('navigator',{platform:'MacIntel',maxTouchPoints:5});
  const view=render(<DesktopInvitationButton invitation={invitation} />);expect(view.container.childElementCount).toBe(0);
  vi.stubGlobal('navigator',{platform:'MacIntel',maxTouchPoints:0});
  view.rerender(<DesktopInvitationButton invitation={{...invitation,pairingCode:undefined}} />);expect(view.container.childElementCount).toBe(0);
});
