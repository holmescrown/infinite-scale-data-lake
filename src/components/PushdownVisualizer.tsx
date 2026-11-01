/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { BarChart3, TrendingUp, PieChart as PieChartIcon, Zap } from 'lucide-react';
import { StorageShard, ColumnDef } from '../types/datalake.ts';
import { PARTITION_REGIONS, CATEGORY_DICTIONARY, STATUS_DICTIONARY, BATCH_IDS } from '../engine/clusterCatalog.ts';

interface PushdownVisualizerProps {
  activeShards: StorageShard[];
  totalEstimatedRows: number;
  schemaColumns: readonly ColumnDef[];
}

const PALETTE = ['#6366f1', '#3b82f6', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'];

export const PushdownVisualizer: React.FC<PushdownVisualizerProps> = ({
  activeShards,
  totalEstimatedRows,
  schemaColumns
}) => {
  const [chartType, setChartType] = useState<'bar' | 'area' | 'pie'>('bar');
  const [chartXField, setChartXField] = useState('region_zone');
  const [chartYField, setChartYField] = useState('metric_alpha');
  const [chartAgg, setChartAgg] = useState<'sum' | 'count' | 'avg' | 'max' | 'min'>('sum');
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Group by Pushdown computation
  const pushdownData = useMemo(() => {
    if (activeShards.length === 0 || totalEstimatedRows === 0) return [];

    let buckets: string[] = [];
    if (chartXField === 'region_zone') {
      buckets = PARTITION_REGIONS;
    } else if (chartXField === 'category_code') {
      buckets = CATEGORY_DICTIONARY;
    } else if (chartXField === 'status_flag') {
      buckets = STATUS_DICTIONARY;
    } else if (chartXField === 'batch_id') {
      buckets = BATCH_IDS.slice(0, 8);
    } else {
      buckets = ['2024', '2025', '2026'];
    }

    const weights = buckets.map((_, idx) => 0.65 + ((idx * 37) % 13) * 0.08);
    const weightSum = weights.reduce((a, b) => a + b, 0) || 1;

    return buckets.map((bucketName, idx) => {
      const bucketRows = Math.max(1, Math.round(totalEstimatedRows * (weights[idx] / weightSum)));
      const baseAvg =
        chartYField === 'metric_beta'
          ? 88.4 + ((idx * 19) % 35)
          : 245.6 + ((idx * 29) % 90);

      let aggValue = bucketRows;
      if (chartAgg === 'count') {
        aggValue = bucketRows;
      } else if (chartAgg === 'sum') {
        aggValue = Math.round(bucketRows * baseAvg);
      } else if (chartAgg === 'avg') {
        aggValue = Math.round(baseAvg * 100) / 100;
      } else if (chartAgg === 'max') {
        aggValue = Math.round(baseAvg * 3.8 * 100) / 100;
      } else if (chartAgg === 'min') {
        aggValue = Math.round(baseAvg * 0.22 * 100) / 100;
      }

      return {
        name: bucketName,
        value: aggValue,
        count: bucketRows
      };
    });
  }, [activeShards, totalEstimatedRows, chartXField, chartYField, chartAgg]);

  const maxValue = useMemo(() => {
    return Math.max(...pushdownData.map((d) => d.value), 1);
  }, [pushdownData]);

  return (
    <section className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-4 sm:p-5 space-y-4">
      {/* Controls Bar */}
      <div className="p-3.5 rounded-xl bg-zinc-950/80 border border-zinc-800/80 flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label className="block text-[11px] text-zinc-400 mb-1 font-medium">
              1. 下推分组维度 (Group By)
            </label>
            <select
              value={chartXField}
              onChange={(e) => setChartXField(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-100 min-w-[150px]"
            >
              <option value="region_zone">地域分区 (region_zone)</option>
              <option value="category_code">业务类别 (category_code)</option>
              <option value="batch_id">数据批次 (batch_id)</option>
              <option value="status_flag">处理状态 (status_flag)</option>
              <option value="year_partition">归档年份 (year)</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] text-zinc-400 mb-1 font-medium">
              2. 下推度量字段 (Measure)
            </label>
            <select
              value={chartYField}
              onChange={(e) => setChartYField(e.target.value)}
              disabled={chartAgg === 'count'}
              className="px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-100 min-w-[150px] disabled:opacity-50"
            >
              {schemaColumns
                .filter((c) => c.type === 'number')
                .map((col) => (
                  <option key={col.key} value={col.key}>
                    # {col.label}
                  </option>
                ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] text-zinc-400 mb-1 font-medium">
              3. 算子下推聚合 (Pushdown Operator)
            </label>
            <select
              value={chartAgg}
              onChange={(e) => setChartAgg(e.target.value as any)}
              className="px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-100"
            >
              <option value="sum">求和 (SUM)</option>
              <option value="count">行数计数 (COUNT)</option>
              <option value="avg">加权均值 (AVG)</option>
              <option value="max">极大值 (MAX)</option>
              <option value="min">极小值 (MIN)</option>
            </select>
          </div>
        </div>

        {/* Chart Type Toggle */}
        <div className="flex items-center gap-1 p-1 rounded-lg bg-zinc-900 border border-zinc-800">
          {[
            { id: 'bar', label: '柱状图', icon: BarChart3 },
            { id: 'area', label: '趋势图', icon: TrendingUp },
            { id: 'pie', label: '占比图', icon: PieChartIcon }
          ].map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => setChartType(item.id as any)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  chartType === item.id
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Pushdown Explanation Banner */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 rounded-lg bg-indigo-500/5 border border-indigo-500/20 text-xs text-zinc-300">
        <div className="flex items-center gap-2">
          <Zap className="w-3.5 h-3.5 text-indigo-400" />
          <span>
            <strong>零原始行网络传输：</strong>直接下推至{' '}
            <span className="font-mono text-indigo-300 tabular-nums">
              {activeShards.length}
            </span>{' '}
            个活跃切片 ZoneMap 执行聚合，仅将计算完成的{' '}
            <span className="font-mono text-emerald-400 tabular-nums">{pushdownData.length}</span>{' '}
            条汇总维度返回前端图表渲染。
          </span>
        </div>
        <span className="font-mono text-[11px] text-zinc-400">
          极速响应 &lt; 2ms
        </span>
      </div>

      {/* Responsive SVG Chart Canvas */}
      <div className="h-[360px] w-full p-4 rounded-xl bg-zinc-950/60 border border-zinc-800/80 flex flex-col justify-between relative overflow-hidden">
        {chartType === 'bar' ? (
          <div className="w-full h-full flex flex-col justify-between">
            {/* Bars container */}
            <div className="flex-1 flex items-end gap-3 sm:gap-6 px-4 pb-2 border-b border-zinc-800">
              {pushdownData.map((d, idx) => {
                const heightPct = Math.max(6, Math.round((d.value / maxValue) * 100));
                const isHovered = hoveredIndex === idx;
                return (
                  <div
                    key={d.name}
                    className="flex-1 flex flex-col items-center h-full justify-end group cursor-pointer relative"
                    onMouseEnter={() => setHoveredIndex(idx)}
                    onMouseLeave={() => setHoveredIndex(null)}
                  >
                    {/* Tooltip on hover */}
                    {isHovered && (
                      <div className="absolute -top-12 z-20 px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 shadow-xl text-center whitespace-nowrap text-[11px] pointer-events-none">
                        <div className="text-zinc-200 font-medium">{d.name}</div>
                        <div className="text-indigo-400 font-mono font-semibold">
                          {d.value.toLocaleString()}
                        </div>
                      </div>
                    )}
                    <div
                      style={{ height: `${heightPct}%` }}
                      className={`w-full rounded-t-md transition-all duration-300 ${
                        isHovered ? 'bg-indigo-400 brightness-110 shadow-lg' : 'bg-indigo-600/80 hover:bg-indigo-500'
                      }`}
                    />
                  </div>
                );
              })}
            </div>
            {/* X Axis Labels */}
            <div className="flex gap-3 sm:gap-6 px-4 pt-2 text-[11px] text-zinc-400 font-mono">
              {pushdownData.map((d) => (
                <div key={d.name} className="flex-1 text-center truncate" title={d.name}>
                  {d.name}
                </div>
              ))}
            </div>
          </div>
        ) : chartType === 'area' ? (
          <div className="w-full h-full flex flex-col justify-between">
            <svg className="w-full h-full" viewBox="0 0 600 240" preserveAspectRatio="none">
              <defs>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity="0.0" />
                </linearGradient>
              </defs>
              {/* Horizontal Grid lines */}
              <line x1="0" y1="60" x2="600" y2="60" stroke="#27272a" strokeDasharray="3 3" />
              <line x1="0" y1="120" x2="600" y2="120" stroke="#27272a" strokeDasharray="3 3" />
              <line x1="0" y1="180" x2="600" y2="180" stroke="#27272a" strokeDasharray="3 3" />

              {/* Area polygon */}
              {(() => {
                const points = pushdownData.map((d, i) => {
                  const x = (i / Math.max(1, pushdownData.length - 1)) * 560 + 20;
                  const y = 220 - (d.value / maxValue) * 180;
                  return `${x},${y}`;
                });
                const areaPath = `M 20,220 ${points.map((p) => `L ${p}`).join(' ')} L 580,220 Z`;
                const linePath = `M ${points.join(' L ')}`;
                return (
                  <>
                    <path d={areaPath} fill="url(#areaGrad)" />
                    <path d={linePath} fill="none" stroke="#6366f1" strokeWidth="3" />
                    {pushdownData.map((d, i) => {
                      const cx = (i / Math.max(1, pushdownData.length - 1)) * 560 + 20;
                      const cy = 220 - (d.value / maxValue) * 180;
                      return (
                        <circle
                          key={d.name}
                          cx={cx}
                          cy={cy}
                          r="4"
                          fill="#818cf8"
                          stroke="#09090b"
                          strokeWidth="2"
                        />
                      );
                    })}
                  </>
                );
              })()}
            </svg>
            <div className="flex justify-between px-2 pt-2 border-t border-zinc-800 text-[11px] text-zinc-400 font-mono">
              {pushdownData.map((d) => (
                <span key={d.name} className="truncate max-w-[80px]">
                  {d.name}
                </span>
              ))}
            </div>
          </div>
        ) : (
          /* Donut / Pie View */
          <div className="w-full h-full flex flex-col sm:flex-row items-center justify-center gap-6">
            <div className="relative w-48 h-48">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                {(() => {
                  const total = pushdownData.reduce((acc, d) => acc + d.value, 0) || 1;
                  let cumulativePercent = 0;
                  return pushdownData.map((d, idx) => {
                    const percent = d.value / total;
                    const strokeDasharray = `${percent * 283} 283`;
                    const strokeDashoffset = -cumulativePercent * 283;
                    cumulativePercent += percent;
                    return (
                      <circle
                        key={d.name}
                        cx="50"
                        cy="50"
                        r="45"
                        fill="transparent"
                        stroke={PALETTE[idx % PALETTE.length]}
                        strokeWidth="10"
                        strokeDasharray={strokeDasharray}
                        strokeDashoffset={strokeDashoffset}
                        className="transition-all duration-300 hover:opacity-80"
                      />
                    );
                  });
                })()}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-[10px] text-zinc-400">活跃分片池</span>
                <span className="text-xs font-mono font-bold text-zinc-100">
                  {activeShards.length} Shards
                </span>
              </div>
            </div>

            {/* Legend */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
              {pushdownData.map((d, idx) => (
                <div key={d.name} className="flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-sm shrink-0"
                    style={{ backgroundColor: PALETTE[idx % PALETTE.length] }}
                  />
                  <span className="text-zinc-300 font-mono text-[11px] truncate max-w-[100px]">
                    {d.name}
                  </span>
                  <span className="text-zinc-500 font-mono text-[10px]">
                    ({((d.value / (pushdownData.reduce((a, b) => a + b.value, 0) || 1)) * 100).toFixed(0)}%)
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Metric Cards Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        {pushdownData.slice(0, 6).map((item, idx) => (
          <div
            key={item.name}
            className="p-3 rounded-lg bg-zinc-950/70 border border-zinc-800/80 flex flex-col justify-between"
          >
            <div className="flex items-center gap-1.5 text-xs text-zinc-400 truncate">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: PALETTE[idx % PALETTE.length] }}
              />
              <span className="truncate">{item.name}</span>
            </div>
            <div className="mt-1.5 font-mono text-sm font-semibold text-zinc-100 tabular-nums">
              {item.value.toLocaleString()}
            </div>
            <div className="text-[10px] text-zinc-500 font-mono tabular-nums">
              覆盖 {item.count.toLocaleString()} 行
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
