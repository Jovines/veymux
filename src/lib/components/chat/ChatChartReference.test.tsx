// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChatChartReference, ChatChartReferenceContext, chartReferenceText, type ChartReferenceData } from './ChatChartReference';

afterEach(cleanup);
const data: ChartReferenceData = { title: '收入', columns: ['月份', '金额'], rows: [['一月', 0], ['二月', -2], ['三月', null]], axes: ['单位：万元'] };
it('quotes labels, units, zeros, negatives and missing values without replacing them with fallback prose', () => {
  expect(chartReferenceText(data, 0)).toBe('收入\n单位：万元\n月份：一月；金额：0');
  expect(chartReferenceText(data)).toContain('金额：-2');
  expect(chartReferenceText(data, 2)).toContain('金额：—');
});
it('invalidates a selected point when live chart data changes and quotes the current snapshot', () => {
  const onReference = vi.fn();
  const mount = (data: ChartReferenceData) => <ChatChartReferenceContext.Provider value={onReference}><ChatChartReference data={data}>{select => <button onClick={() => select(1)}>点选</button>}</ChatChartReference></ChatChartReferenceContext.Provider>;
  const view = render(mount(data));
  fireEvent.click(screen.getByText('点选'));
  expect(screen.getByRole('status').textContent).toContain('金额：-2');
  view.rerender(mount({ ...data, rows: [['四月', 20]] }));
  expect(screen.queryByRole('status')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '引用图表' }));
  expect(onReference).toHaveBeenCalledWith('收入\n单位：万元\n月份：四月；金额：20');
});
it('does not offer references for empty charts', () => {
  render(<ChatChartReferenceContext.Provider value={vi.fn()}><ChatChartReference data={{ ...data, rows: [] }}>{() => <p>无数据</p>}</ChatChartReference></ChatChartReferenceContext.Provider>);
  expect(screen.queryByRole('button')).toBeNull();
});
