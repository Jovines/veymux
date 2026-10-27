import { createContext, useContext, useId, useState, type ReactNode } from 'react';
import { ChevronDown, Quote, X } from 'lucide-react';

export const ChatChartReferenceContext = createContext<((text: string) => void) | undefined>(undefined);
export interface ChartReferenceData {
  title: string;
  columns: string[];
  rows: (string | number | null)[][];
  axes?: string[];
}

export function chartReferenceText(data: ChartReferenceData, index?: number): string {
  const rows = index === undefined ? data.rows : data.rows.slice(index, index + 1);
  return [data.title, ...(data.axes ?? []), ...rows.map(row => data.columns.map((column, i) => `${column}：${row[i] ?? '—'}`).join('；'))].join('\n');
}

/** Keep point selection local: it neither submits a message nor changes saved
 * OpenUI state. A data refresh invalidates the old selection immediately. */
export function ChatChartReference({ data, children }: {
  data: ChartReferenceData; children: (select: (index: number) => void) => ReactNode;
}) {
  const onReference = useContext(ChatChartReferenceContext), tableId = useId();
  const [expanded, setExpanded] = useState(false);
  const [selection, setSelection] = useState<{ source: string; index: number }>();
  const source = JSON.stringify(data);
  const selected = selection?.source === source && data.rows[selection.index] ? selection.index : undefined;
  const select = (index: number) => { if (data.rows[index]) setSelection({ source, index }); };
  const action = 'inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg px-2 text-xs hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  return <div data-chat-chart className="veymux-native-select min-w-0 space-y-2">
    {children(select)}
    {!!data.rows.length && <>
      {selected !== undefined && <div className="flex items-start gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs leading-6">
        <p role="status" className="min-w-0 flex-1 break-words">已选：{data.columns.map((column, i) => `${column}：${data.rows[selected][i] ?? '—'}`).join(' · ')}</p>
        <button type="button" aria-label="取消图表数据选择" className={action} onClick={() => setSelection(undefined)}><X size={14} /></button>
      </div>}
      <div className="flex items-center justify-between gap-2">
        <button type="button" aria-expanded={expanded} aria-controls={tableId} className={`${action} text-muted-foreground`} onClick={() => setExpanded(value => !value)}><ChevronDown size={14} className={expanded ? 'rotate-180' : ''} />{expanded ? '收起数据' : '查看数据'}</button>
        {onReference && <button type="button" className={`${action} shrink-0 text-primary`} onPointerDown={event => event.preventDefault()} onClick={() => onReference(chartReferenceText(data, selected))}><Quote size={14} />{selected === undefined ? '引用图表' : '引用所选数据'}</button>}
      </div>
      {expanded && <div id={tableId} role="region" aria-label={`${data.title}数据`} tabIndex={0} className="max-h-80 max-w-full overflow-auto rounded-lg border border-border overscroll-contain">
        <table className="w-full text-left text-xs leading-6"><caption className="sr-only">{data.title}数据</caption><thead className="sticky top-0 z-10 bg-surface"><tr>{data.columns.map((column, i) => <th key={i} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">{column}</th>)}{onReference && <th scope="col" className="px-2 py-2">选择</th>}</tr></thead>
          <tbody>{data.rows.map((row, index) => <tr key={index} className={selected === index ? 'bg-surface-2' : 'border-t border-border/50'}>{data.columns.map((_, i) => <td key={i} className="whitespace-nowrap px-3 py-2 tabular-nums">{row[i] ?? '—'}</td>)}{onReference && <td className="px-2"><button type="button" aria-label={`选择第${index + 1}行数据`} aria-pressed={selected === index} className={`${action} whitespace-nowrap text-primary`} onClick={() => select(index)}>{selected === index ? '已选择' : '选择'}</button></td>}</tr>)}</tbody>
        </table>
      </div>}
    </>}
  </div>;
}
