import type { ComponentType, ReactNode } from 'react';
import {
  AreaChartCondensed as NativeAreaChart, BarChartCondensed as NativeBarChart,
  LineChartCondensed as NativeLineChart, HorizontalBarChart as NativeHorizontalBarChart,
  PieChart as NativePieChart, RadialChart as NativeRadialChart, RadarChart as NativeRadarChart,
  ScatterChart as NativeScatterChart, SingleStackedBar as NativeSingleStackedBar,
  type ChartData, type AreaChartCondensedProps, type BarChartCondensedProps, type LineChartCondensedProps,
  type HorizontalBarChartProps, type PieChartProps, type RadialChartProps, type RadarChartProps,
  type ScatterChartProps, type ScatterPoint, type SingleStackedBarProps,
} from '@openuidev/react-ui/Charts';
import { ChatChartReference, type ChartReferenceData } from './ChatChartReference';
export * from '@openuidev/react-ui/Charts';

interface DataChartProps {
  data: ChartData; categoryKey: string; dataKey?: string;
  xAxisLabel?: ReactNode; yAxisLabel?: ReactNode;
  onClick?: (row: ChartData[number], index: number) => void;
}
function withReferences<P extends DataChartProps>(Component: ComponentType<P>, title: string) {
  return function ReferenceChart(props: P) {
    const { data, categoryKey, dataKey, xAxisLabel, yAxisLabel } = props;
    const keys = dataKey ? [dataKey] : [...new Set(data.flatMap(row => Object.keys(row)))].filter(key => key !== categoryKey);
    const reference: ChartReferenceData = {
      title, columns: [typeof xAxisLabel === 'string' ? xAxisLabel : '项目', ...keys.map(key => key === dataKey ? '数值' : key)],
      rows: data.map(row => [row[categoryKey], ...keys.map(key => row[key] ?? null)]),
      axes: [typeof yAxisLabel === 'string' ? `纵轴：${yAxisLabel}` : '', typeof xAxisLabel === 'string' ? `横轴：${xAxisLabel}` : ''].filter(Boolean),
    };
    return <ChatChartReference data={reference}>{select => <Component {...props} onClick={(row: ChartData[number], index: number) => {
      const originalIndex = data.findIndex(item => item === row || Object.keys(item).every(key => item[key] === row[key]));
      select(originalIndex); props.onClick?.(row, index);
    }} />}</ChatChartReference>;
  };
}

export const BarChartCondensed = withReferences<BarChartCondensedProps<ChartData>>(NativeBarChart, '柱状图');
export const LineChartCondensed = withReferences<LineChartCondensedProps<ChartData>>(NativeLineChart, '折线图');
export const AreaChartCondensed = withReferences<AreaChartCondensedProps<ChartData>>(NativeAreaChart, '面积图');
export const HorizontalBarChart = withReferences<HorizontalBarChartProps<ChartData>>(NativeHorizontalBarChart, '横向柱状图');
export const PieChart = withReferences<PieChartProps<ChartData>>(NativePieChart, '饼图');
export const RadialChart = withReferences<RadialChartProps<ChartData>>(NativeRadialChart, '径向图');
export const RadarChart = withReferences<RadarChartProps<ChartData>>(NativeRadarChart, '雷达图');
export const SingleStackedBar = withReferences<SingleStackedBarProps<ChartData>>(NativeSingleStackedBar, '堆叠条形图');
export function ScatterChart(props: ScatterChartProps) {
  const points: (ScatterPoint & { series: string })[] = props.data.flatMap(dataset => dataset.data.map(point => ({ ...point, series: dataset.name })));
  const xKey = props.xAxisDataKey ?? 'x', yKey = props.yAxisDataKey ?? 'y';
  const hasZ = points.some(point => point.z !== undefined);
  const reference: ChartReferenceData = { title: '散点图', columns: ['系列', typeof props.xAxisLabel === 'string' ? props.xAxisLabel : 'X', typeof props.yAxisLabel === 'string' ? props.yAxisLabel : 'Y', ...(hasZ ? ['Z'] : [])],
    rows: points.map(point => [point.series, point[xKey] ?? null, point[yKey] ?? null, ...(hasZ ? [point.z ?? null] : [])]) };
  return <ChatChartReference data={reference}>{select => <NativeScatterChart {...props} onClick={(point, name, datasetIndex, pointIndex) => {
    select(props.data.slice(0, datasetIndex).reduce((sum, dataset) => sum + dataset.data.length, 0) + pointIndex);
    props.onClick?.(point, name, datasetIndex, pointIndex);
  }} />}</ChatChartReference>;
}
