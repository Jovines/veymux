import { useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { commands, page } from 'vitest/browser';
import { Swiper, SwiperSlide } from 'swiper/react';
import 'swiper/css';
import '../../index.css';
import { FreeSplitLayout } from './FreeSplitLayout';
import { useCollaborationPanelDock } from '../stores/useCollaborationPanelDock';

const api = vi.hoisted(() => ({ getSettings: vi.fn().mockResolvedValue({}), updateSettings: vi.fn().mockResolvedValue({}) }));
vi.mock('../terminal/api', () => api);
let root: Root | undefined;
const mounts = new Map<string, number>();
afterEach(() => {
  root?.unmount(); root = undefined; document.body.replaceChildren(); mounts.clear();
  useCollaborationPanelDock.setState({ docks: {}, hosts: {}, activePaneId: null });
  vi.clearAllMocks();
});
const pane = (id: string) => document.querySelector<HTMLElement>(`[data-layout-pane="${id}"]`)!;
const geometry = () => Object.fromEntries(Array.from(document.querySelectorAll<HTMLElement>('[data-layout-pane]')).map(el => [el.dataset.layoutPane!, [el.style.left, el.style.top, el.style.width, el.style.height]]));
function assertTiling(ids: string[]) {
  const rects = ids.map(id => pane(id).getBoundingClientRect());
  const host = document.querySelector('[data-split-container]')!.getBoundingClientRect();
  expect(document.querySelectorAll('[data-layout-pane]')).toHaveLength(ids.length);
  expect(rects.reduce((sum, r) => sum + r.width * r.height, 0) / (host.width * host.height)).toBeCloseTo(1, 3);
  for (const a of rects) {
    expect(a.width).toBeGreaterThan(0); expect(a.height).toBeGreaterThan(0);
    for (const b of rects) if (a !== b) expect(Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))).toBeLessThan(1);
  }
  for (const id of ids) expect(mounts.get(id)).toBe(1);
  expect(document.querySelector('[data-drag-placeholder]')).toBeNull();
}
async function setup(count = 4, preset: 'grid' | 'horizontal' | 'vertical' = 'grid', mobile = false) {
  await page.viewport(mobile ? 390 : 1440, mobile ? 844 : 900);
  function Content({ id }: { id: string }) {
    useEffect(() => { mounts.set(id, (mounts.get(id) ?? 0) + 1); }, [id]);
    return <div className="flex h-full flex-col"><button data-split-pane-title={id} className="h-8 shrink-0 touch-none">Pane {id}</button><textarea aria-label={`Draft ${id}`} defaultValue={`draft-${id}`} className="min-h-0 flex-1" /></div>;
  }
  function Fixture() {
    const [ids, setIds] = useState(Array.from({ length: count }, (_, i) => String.fromCharCode(97 + i)));
    const [mode, setMode] = useState(preset);
    const [focus, setFocus] = useState<string | null>(null);
    return <div className="h-dvh flex flex-col p-4"><nav className="flex h-10 shrink-0 gap-3">
      <button onClick={() => setMode('horizontal')}>左右排列</button><button onClick={() => setMode('vertical')}>上下排列</button><button onClick={() => setMode('grid')}>四宫格</button>
      <button onClick={() => setIds(ids.filter(id => id !== 'd'))}>移除 D</button><button onClick={() => setIds([...ids, 'e'])}>加入 E</button>
      <button onClick={() => setFocus(focus ? null : 'a')}>专注 A</button>
    </nav><Swiper className="w-full min-h-0 flex-1" touchStartPreventDefault={false} simulateTouch={false}><SwiperSlide className="h-full">
      <FreeSplitLayout layoutId="browser-audit" preset={mode} mobile={mobile} focusId={focus} panes={ids.map(id => ({ id, content: <Content id={id} /> }))} />
    </SwiperSlide></Swiper></div>;
  }
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  flushSync(() => root!.render(<Fixture />));
  await expect.poll(() => document.querySelector<HTMLButtonElement>('[role=separator]')?.disabled).toBe(false);
  return Array.from({ length: count }, (_, i) => String.fromCharCode(97 + i));
}
async function gesture(source: string, target: string, rx = 0.5, ry = 0.5, finish = 'release', touch = false) {
  await (commands as any).splitGesture(source, target, rx, ry, finish, touch);
}
const title = (id: string) => `[data-split-pane-title="${id}"]`;
const target = (id: string) => `[data-layout-pane="${id}"]`;

for (const [side, rx, ry] of [['left', 0.05, 0.5], ['right', 0.95, 0.5], ['top', 0.5, 0.05], ['bottom', 0.5, 0.95], ['center', 0.5, 0.5]] as const) {
  it(`moves a pane to ${side} with real pointer capture and preserves its DOM and draft`, async () => {
    const ids = await setup(); const originals = Object.fromEntries(ids.map(id => [id, pane(id)]));
    const before = geometry();
    await gesture(title('d'), target('a'), rx, ry);
    assertTiling(ids);
    if (side === 'center') { expect(geometry().d).toEqual(before.a); expect(geometry().a).toEqual(before.d); }
    else {
      const a = pane('a').getBoundingClientRect(), d = pane('d').getBoundingClientRect();
      if (side === 'left') expect(d.right).toBeCloseTo(a.left, 0);
      if (side === 'right') expect(a.right).toBeCloseTo(d.left, 0);
      if (side === 'top') expect(d.bottom).toBeCloseTo(a.top, 0);
      if (side === 'bottom') expect(a.bottom).toBeCloseTo(d.top, 0);
    }
    for (const id of ids) { expect(pane(id)).toBe(originals[id]); expect(pane(id).querySelector('textarea')!.value).toBe(`draft-${id}`); }
    expect(api.updateSettings).toHaveBeenCalled();
  });
}
for (const preset of ['horizontal', 'vertical'] as const) {
  it(`resizes ${preset} splits with minimum bounds and resets on double click`, async () => {
    const ids = await setup(2, preset); const axis = preset === 'horizontal' ? 'width' : 'height';
    await gesture('[role=separator]', '[data-split-container]', 0.7, 0.7);
    expect(parseFloat(pane('a').style[axis])).toBeCloseTo(70, 0); assertTiling(ids);
    await gesture('[role=separator]', '[data-split-container]', -0.5, -0.5);
    expect(pane('a').getBoundingClientRect()[axis]).toBeGreaterThanOrEqual(119); assertTiling(ids);
    await page.getByRole('separator').dblClick();
    expect(pane('a').style[axis]).toBe('50%');
  });
}
it('resizes all four half-lines repeatedly after crossing T junctions without gaps', async () => {
  const ids = await setup();
  for (const [side, rx, ry] of [['上', 0.3, 0.2], ['下', 0.7, 0.8], ['左', 0.2, 0.3], ['右', 0.8, 0.7], ['上', 0.65, 0.2], ['下', 0.35, 0.8]] as const) {
    const before = geometry();
    await gesture(`[aria-label="调整${side}半段分隔线"]`, '[data-split-container]', rx, ry);
    expect(geometry()).not.toEqual(before); assertTiling(ids);
    const id = side === '下' ? 'c' : side === '右' ? 'b' : 'a';
    expect(parseFloat(pane(id).style[side === '上' || side === '下' ? 'width' : 'height'])).toBeCloseTo((side === '上' || side === '下' ? rx : ry) * 100, 0);
  }
});
for (const finish of ['escape', 'outside', 'blur']) it(`cancels a ${finish} drop and allows the next drag`, async () => {
  const ids = await setup(); const before = geometry();
  await gesture(title('d'), target('a'), 0.5, 0.5, finish);
  expect(geometry()).toEqual(before); assertTiling(ids);
  await gesture(title('d'), target('a'));
  expect(geometry().d).toEqual(before.a); assertTiling(ids);
});
it('ignores a drop on itself and a click without movement', async () => {
  const ids = await setup(); const before = geometry();
  await gesture(title('a'), target('a')); expect(geometry()).toEqual(before);
  await page.getByRole('button', { name: 'Pane a', exact: true }).click();
  expect(geometry()).toEqual(before); assertTiling(ids);
});
it('switches presets, removes a pane, adds one and restores focus without remounting survivors', async () => {
  await setup();
  for (const mode of ['左右排列', '上下排列', '四宫格']) { await page.getByRole('button', { name: mode, exact: true }).click(); assertTiling(['a', 'b', 'c', 'd']); }
  const before = geometry();
  await page.getByRole('button', { name: '专注 A', exact: true }).click(); expect(pane('a').style.width).toBe('100%');
  await page.getByRole('button', { name: '专注 A', exact: true }).click(); expect(geometry()).toEqual(before);
  await page.getByRole('button', { name: '移除 D', exact: true }).click(); assertTiling(['a', 'b', 'c']);
  await page.getByRole('button', { name: '加入 E', exact: true }).click(); assertTiling(['a', 'b', 'c', 'e']);
});
for (const count of [3, 5, 6]) it(`maintains ${count} panes through nested moves`, async () => {
  const ids = await setup(count);
  for (const [rx, ry] of [[0.05, 0.5], [0.5, 0.95], [0.5, 0.5]]) {
    const before = geometry();
    await gesture(title(ids.at(-1)!), target('a'), rx, ry);
    expect(geometry()).not.toEqual(before); assertTiling(ids);
  }
});
it('moves, swaps and cancels with native touch inside Swiper on a phone viewport', async () => {
  const ids = await setup(4, 'grid', true); const before = geometry();
  const handle = `${target('d')} [data-panel-drag-title]`;
  await gesture(handle, target('a'), 0.5, 0.5, 'release', true);
  expect(geometry().d).toEqual(before.a); assertTiling(ids);
  const swapped = geometry();
  await gesture(handle, target('b'), 0.5, 0.5, 'cancel', true);
  expect(geometry()).toEqual(swapped); assertTiling(ids);
  await gesture(handle, target('a'), 0.5, 0.95, 'release', true);
  expect(geometry()).not.toEqual(swapped); assertTiling(ids);
});
