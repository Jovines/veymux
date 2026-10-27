import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import '../../../index.css';
import { I18nProvider } from '../../i18n';
import { SettingsSections } from './SettingsSections';
import { VeymuxUpdateSettings } from './VeymuxUpdateSettings';
import { summarizeServiceUpdates } from '../../terminal/serviceUpdateOverview';
import type { VeymuxUpdateState } from '../../terminal/api';
import type { ServiceUpdatePlan } from '../../terminal/serviceUpdatePlan';

const plan: ServiceUpdatePlan = { targetId: 'work', interfaceId: 'linux', nodes: [
  { intent: { targetPeerId: 'work', url: 'https://work.example' }, label: 'Work', role: 'target' },
  { intent: { targetPeerId: 'linux', url: 'https://entry.example' }, label: 'Linux', role: 'interface' },
] };
const current: VeymuxUpdateState = { status: 'current', currentVersion: '1.4.366', latestVersion: '1.4.366', checkedAt: 1, source: 'official', error: null };
let root: Root;
afterEach(() => { flushSync(() => root?.unmount()); document.body.innerHTML = ''; vi.unstubAllGlobals(); });

it.each([320, 390, 1280])('checks, inspects versions and confirms only real updates at %i px', async width => {
  await page.viewport(width, 844);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ locale: 'en' })));
  localStorage.setItem('veymux:locale', 'en');
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  const check = vi.fn(), restart = vi.fn();
  const render = (entry: VeymuxUpdateState | undefined, busy = false) => {
    const context = { ...summarizeServiceUpdates(plan, { work: { state: current }, linux: { state: entry } }, false), check: async () => undefined, busy };
    flushSync(() => root.render(<I18nProvider><div className="fixed inset-0 flex flex-col bg-surface text-foreground"><header className="p-4">Settings</header><SettingsSections><div>Appearance</div><div>Controls</div><div><VeymuxUpdateSettings state={current} pending={false} onCheck={check} onConfirmRestart={restart} updateContext={context} /><button className="mt-3 min-h-11">Service health</button></div></SettingsSections></div></I18nProvider>));
  };
  render(current);
  await page.getByRole('tab', { name: 'Service and diagnostics' }).click();
  await expect.element(page.getByRole('status')).toHaveTextContent('All connected services are up to date.');
  await page.getByRole('button', { name: 'Check again', exact: true }).click(); expect(check).toHaveBeenCalledOnce(); expect(restart).not.toHaveBeenCalled();
  render(undefined, true);
  await expect.element(page.getByRole('button', { name: 'Checking…' })).toBeDisabled();
  render(undefined);
  await expect.element(page.getByRole('status')).toHaveTextContent('could not be confirmed');
  render({ ...current, currentVersion: '1.4.365', status: 'ready' });
  await expect.element(page.getByRole('status')).toHaveTextContent('“Linux” can update to 1.4.366.');
  const action = page.getByRole('button', { name: 'Update and restart', exact: true });
  await expect.element(action).toBeVisible();
  const button = [...document.querySelectorAll('button')].find(item => item.textContent === 'Update and restart')!;
  const box = button.getBoundingClientRect(); expect(box.height).toBeGreaterThanOrEqual(44); expect(box.right).toBeLessThanOrEqual(width); expect(box.bottom).toBeLessThanOrEqual(844);
  await page.getByText('Version details', { exact: true }).click();
  await expect.element(page.getByText('Interface provider · v1.4.365 → 1.4.366 · Update ready', { exact: true })).toBeVisible();
  await action.click(); expect(restart).toHaveBeenCalledOnce();
  expect(document.documentElement.scrollWidth).toBe(width);
});
