import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import '../../../index.css';
import { SessionChatView } from './SessionChatView';
import { clearChatSnapshots } from './chatSnapshot';
import { parseChatContent } from './chatReferences';
import type { ChatMessage } from './chatMessages';

declare module 'vitest/browser' {
  interface BrowserCommands {
    chartPointer(selector: string, touch: boolean, xRatio?: number): Promise<void>;
    captureChartReference(width: number): Promise<void>;
  }
}

let root: Root | undefined;
afterEach(() => {
  root?.unmount(); root = undefined;
  window.getSelection()?.removeAllRanges();
  clearChatSnapshots(); sessionStorage.clear(); vi.unstubAllGlobals(); document.body.replaceChildren();
});

const charts = [
  { name: '柱状图', code: 'BarChart(["一月", "二月", "三月"], [Series("收入", [12, 18, 9]), Series("成本", [5, 7, 4])], "grouped", "月份", "万元")', selector: 'svg[aria-label="Bar chart"] rect[fill="transparent"]', text: ['二月', '收入：18', '成本：7'] },
  { name: '折线图', code: 'LineChart(["一月", "二月", "三月"], [Series("收入", [12, 18, 9])], "linear", "月份", "万元")', selector: 'svg[aria-label="Line chart"] rect[fill="transparent"]', text: ['二月', '收入：18'] },
  { name: '饼图', code: 'PieChart(["产品A", "产品B"], [60, 40])', selector: 'svg[aria-label="Pie chart"]', x: 0.75, text: ['产品A', '数值：60'] },
];

async function mountChart(code: string, canWrite = true, version: 1 | 2 = 2) {
  const posts: string[] = [];
  const message: ChatMessage = { id: 'chart', role: 'assistant', content: '图表的后备文字', createdAt: 1, status: 'stored', ui: { version, code: `root = Stack([${code}])` } };
  vi.stubGlobal('fetch', vi.fn(async (_url, init?: RequestInit) => {
    if (init?.method === 'POST') { posts.push(JSON.parse(String(init.body)).content); return Response.json({ id: 'sent', createdAt: 2, status: 'pending' }); }
    return Response.json({ agentAvailable: true, agent: { displayName: 'Codex' }, messages: [message] });
  }));
  const host = document.createElement('div'); host.id = 'root'; document.body.append(host);
  root = createRoot(host); root.render(<SessionChatView sessionId="chart-reference" canWrite={canWrite} onTerminal={() => {}} />);
  await expect.poll(() => !!host.querySelector('[role="img"]'), { timeout: 10000 }).toBe(true);
  return posts;
}

for (const width of [390, 1280]) for (const chart of charts) {
  it(`selects and quotes ${chart.name} data using ${width === 390 ? 'touch' : 'mouse'} at ${width}px`, async () => {
    await page.viewport(width, 844);
    const posts = await mountChart(chart.code);
    await page.getByRole('textbox', { name: '给Codex的消息' }).fill('解释这组数据');
    await commands.chartPointer(chart.selector, width === 390, chart.x);
    await expect.poll(() => !!page.getByRole('button', { name: '引用所选数据', exact: true }).query(), { timeout: 1500 }).toBe(true);
    expect(posts).toEqual([]);
    if (chart.name === '柱状图') await commands.captureChartReference(width);
    await page.getByRole('button', { name: '引用所选数据', exact: true }).click();
    await expect.element(page.getByRole('button', { name: '移除消息引用' })).toBeVisible();
    const quote = document.querySelector('.session-chat-composer blockquote')!.textContent!;
    for (const text of chart.text) expect(quote).toContain(text);
    await page.getByRole('textbox', { name: '给Codex的消息' }).fill('解释这组数据');
    await page.getByRole('button', { name: '发送消息' }).click();
    await expect.poll(() => posts.length).toBe(1);
    const reference = parseChatContent(posts[0]).reference!;
    expect(reference.author).toBe('Codex');
    for (const text of chart.text) expect(reference.text).toContain(text);
    expect(reference.text).not.toContain('图表的后备文字');
  });
}

it('quotes the whole chart, cancels a point, and selects exact rows with the keyboard without losing a draft', async () => {
  await page.viewport(390, 844);
  const posts = await mountChart(charts[0].code);
  await page.getByRole('textbox', { name: '给Codex的消息' }).fill('保留这份草稿');
  await page.getByRole('button', { name: '引用图表', exact: true }).click();
  let quote = document.querySelector('.session-chat-composer blockquote')!.textContent!;
  for (const value of ['一月', '二月', '三月', '收入：18', '纵轴：万元', '横轴：月份']) expect(quote).toContain(value);
  await page.getByRole('button', { name: '移除消息引用' }).click();
  await commands.chartPointer(charts[0].selector, true);
  await page.getByRole('button', { name: '取消图表数据选择' }).click();
  await expect.element(page.getByRole('button', { name: '引用图表', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '查看数据', exact: true }).click();
  (page.getByRole('button', { name: '选择第3行数据' }).element() as HTMLElement).focus();
  await userEvent.keyboard('{Enter}');
  await expect.element(page.getByRole('button', { name: '选择第3行数据' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '引用所选数据', exact: true }).click();
  quote = document.querySelector('.session-chat-composer blockquote')!.textContent!;
  expect(quote).toContain('三月'); expect(quote).toContain('收入：9'); expect(quote).not.toContain('二月');
  await expect.element(page.getByRole('textbox', { name: '给Codex的消息' })).toHaveTextContent('保留这份草稿');
  expect(posts).toEqual([]);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
});

it('keeps readonly charts readable without offering quote or row selection actions', async () => {
  await mountChart(charts[0].code, false);
  await page.getByRole('button', { name: '查看数据', exact: true }).click();
  await expect.element(page.getByRole('cell', { name: '二月' })).toBeVisible();
  expect(page.getByRole('button', { name: '引用图表', exact: true }).query()).toBeNull();
  expect(page.getByRole('button', { name: '选择第1行数据' }).query()).toBeNull();
});

it('quotes saved version-one charts through the same composer', async () => {
  await mountChart('Chart("旧版收入", ["一月", "二月"], [{name:"收入", values:[12,18]}], "bar")', true, 1);
  await commands.chartPointer('svg[aria-label="旧版收入"] rect:last-of-type', false);
  await page.getByRole('button', { name: '引用所选数据', exact: true }).click();
  const quote = document.querySelector('.session-chat-composer blockquote')!.textContent!;
  expect(quote).toContain('旧版收入'); expect(quote).toContain('二月'); expect(quote).toContain('收入：18');
});

for (const chart of [
  { code: 'AreaChart(["一月", "二月"], [Series("收入", [12, 18])])', value: '收入：18' },
  { code: 'HorizontalBarChart(["一月", "二月"], [Series("收入", [12, 18])])', value: '收入：18' },
  { code: 'RadarChart(["一月", "二月", "三月"], [Series("收入", [12, 18, 9])])', value: '收入：18' },
  { code: 'RadialChart(["一月", "二月"], [12, 18])', value: '数值：18' },
  { code: 'SingleStackedBarChart(["一月", "二月"], [12, 18])', value: '数值：18' },
  { code: 'ScatterChart([ScatterSeries("试验组", [Point(1, 2), Point(3, 4, 5)])])', value: 'Z：5' },
]) {
  it(`exposes and quotes exact rows for ${chart.code.split('(')[0]}`, async () => {
    await mountChart(chart.code);
    await page.getByRole('button', { name: '查看数据', exact: true }).click();
    await expect.element(page.getByRole('button', { name: '选择第2行数据' })).toBeVisible();
    await page.getByRole('button', { name: '选择第2行数据' }).click();
    await page.getByRole('button', { name: '引用所选数据', exact: true }).click();
    const quote = document.querySelector('.session-chat-composer blockquote')!.textContent!;
    expect(quote).toContain(chart.value);
  });
}
