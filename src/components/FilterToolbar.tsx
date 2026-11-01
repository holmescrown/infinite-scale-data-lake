/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  Search,
  Filter,
  Columns,
  RotateCcw,
  X,
  FileSpreadsheet,
  BarChart3,
  Calendar,
  CheckSquare
} from 'lucide-react';
import { StorageShard, PartitionFilter, ColumnDef } from '../types/datalake.ts';
import { PARTITION_REGIONS, CATEGORY_DICTIONARY, BATCH_IDS } from '../engine/clusterCatalog.ts';

interface FilterToolbarProps {
  allShards: StorageShard[];
  selectedShardId: string;
  onSelectShard: (shardId: string) => void;
  globalSearch: string;
  onSearchChange: (query: string) => void;
  filters: PartitionFilter[];
  onAddFilter: (f: Omit<PartitionFilter, 'id'>) => void;
  onRemoveFilter: (id: string) => void;
  onResetFilters: () => void;
  allColumns: readonly ColumnDef[];
  visibleColumns: ColumnDef[];
  hiddenColumns: Record<string, boolean>;
  onToggleColumn: (key: string) => void;
  onSelectAllColumns: () => void;
  jumpRowInput: string;
  onJumpRowInputChange: (val: string) => void;
  onJumpToRow: (rowNum: number) => void;
  totalEstimatedRows: number;
  workspaceMode: 'grid' | 'chart';
  onSetWorkspaceMode: (mode: 'grid' | 'chart') => void;
  pageSize: number;
}

export const FilterToolbar: React.FC<FilterToolbarProps> = ({
  allShards,
  selectedShardId,
  onSelectShard,
  globalSearch,
  onSearchChange,
  filters,
  onAddFilter,
  onRemoveFilter,
  onResetFilters,
  allColumns,
  visibleColumns,
  hiddenColumns,
  onToggleColumn,
  onSelectAllColumns,
  jumpRowInput,
  onJumpRowInputChange,
  onJumpToRow,
  totalEstimatedRows,
  workspaceMode,
  onSetWorkspaceMode,
  pageSize
}) => {
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isColumnOpen, setIsColumnOpen] = useState(false);

  const [filterField, setFilterField] = useState('region_zone');
  const [filterOp, setFilterOp] = useState<PartitionFilter['operator']>('equals');
  const [filterVal, setFilterVal] = useState('');

  const operatorLabels: Record<PartitionFilter['operator'], string> = {
    equals: '等于 (=)',
    not_equals: '不等于 (≠)',
    contains: '包含 (Contains)',
    gt: '大于 (>)',
    lt: '小于 (<)'
  };

  const quickChips = React.useMemo(() => {
    if (filterField === 'region_zone') return PARTITION_REGIONS;
    if (filterField === 'category_code') return CATEGORY_DICTIONARY;
    if (filterField === 'batch_id') return BATCH_IDS.slice(0, 6);
    if (filterField === 'event_timestamp') return ['2024-01-01', '2025-01-01', '2026-01-01'];
    if (filterField === 'record_id') {
      return ['REC-000000000001', 'REC-000100000000', 'REC-000500000000', 'REC-001000000000'];
    }
    return [];
  }, [filterField]);

  const handleApplyFilter = () => {
    if (!filterVal.trim()) return;
    onAddFilter({
      field: filterField,
      operator: filterOp,
      value: filterVal.trim()
    });
    setFilterVal('');
    setIsFilterOpen(false);
  };

  return (
    <div className="rounded-xl bg-zinc-900/60 border border-zinc-800/80 p-3.5 space-y-3">
      {/* Row 1: Shard Navigation & Mode Switch */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Shard Selection Dropdown */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-400 font-medium">切片导航:</span>
          <select
            value={selectedShardId}
            onChange={(e) => onSelectShard(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 focus:outline-none focus:border-indigo-500 max-w-xs"
          >
            <option value="ALL_SHARDS">
              🌐 全湖联邦视图 (所有 {allShards.length} 个存储节点 · 动态寻址)
            </option>
            {allShards.map((s) => (
              <option key={s.id} value={s.id}>
                📦 {s.name} ({s.zone_map.batch_id}) — {s.rows.toLocaleString()} 行
              </option>
            ))}
          </select>

          {/* Quick Row Presets for massive lake navigation */}
          <div className="hidden xl:flex items-center gap-1 pl-2 border-l border-zinc-800 text-[11px]">
            <span className="text-zinc-500 mr-1">秒级游标直达:</span>
            {[
              { label: '首行', row: 1 },
              { label: '1 亿行', row: 100_000_000 },
              { label: '10 亿行', row: 1_000_000_000 },
              { label: '50 亿行', row: 5_000_000_000 },
              { label: '100 亿行', row: 10_000_000_000 },
              { label: '末行视窗', row: Math.max(1, totalEstimatedRows - pageSize + 1) }
            ].map((preset) => (
              <button
                key={preset.label}
                onClick={() => onJumpToRow(preset.row)}
                className="px-2 py-0.5 rounded bg-zinc-950 hover:bg-zinc-800 text-zinc-300 border border-zinc-800/80 font-mono transition-colors active:scale-95"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* View Switcher: Grid vs Pushdown */}
        <div className="flex items-center p-1 rounded-lg bg-zinc-950 border border-zinc-800">
          <button
            onClick={() => onSetWorkspaceMode('grid')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
              workspaceMode === 'grid'
                ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-indigo-400" />
            <span>流式视窗表格</span>
          </button>
          <button
            onClick={() => onSetWorkspaceMode('chart')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
              workspaceMode === 'chart'
                ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5 text-emerald-400" />
            <span>算子下推分析</span>
          </button>
        </div>
      </div>

      {/* Row 2: Search, Partition Pruning Filters & Column Projection */}
      <div className="pt-2 border-t border-zinc-800/70 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          {/* Instant Search */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={globalSearch}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="视窗快速检索..."
              className="pl-8 pr-7 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 w-44 sm:w-52"
            />
            {globalSearch && (
              <button
                onClick={() => onSearchChange('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Add Filter Popover Button */}
          <div className="relative">
            <button
              onClick={() => {
                setIsFilterOpen(!isFilterOpen);
                setIsColumnOpen(false);
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                filters.length > 0 || isFilterOpen
                  ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300'
                  : 'bg-zinc-950 hover:bg-zinc-900 border-zinc-800 text-zinc-300'
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              <span>+ 添加分区裁剪条件</span>
            </button>

            {isFilterOpen && (
              <div className="absolute left-0 mt-2 w-80 sm:w-96 rounded-xl bg-zinc-900 border border-zinc-700/80 shadow-2xl p-4 z-40 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-200">
                    添加分区边界裁剪规则 (ZoneMap Pruning)
                  </span>
                  <button
                    onClick={() => setIsFilterOpen(false)}
                    className="text-zinc-400 hover:text-zinc-200"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="space-y-2.5 text-xs">
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">分区或数据列</label>
                    <select
                      value={filterField}
                      onChange={(e) => setFilterField(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-200"
                    >
                      {allColumns.map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.label} ({c.type})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">比较运算符</label>
                    <select
                      value={filterOp}
                      onChange={(e) => setFilterOp(e.target.value as PartitionFilter['operator'])}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-200"
                    >
                      {Object.entries(operatorLabels).map(([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">
                      目标边界值 (支持直接裁剪无交集切片)
                    </label>
                    <input
                      type="text"
                      value={filterVal}
                      onChange={(e) => setFilterVal(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleApplyFilter()}
                      placeholder="输入目标值或点击下方候选项..."
                      className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-200"
                    />
                    {quickChips.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {quickChips.map((chip) => (
                          <button
                            key={chip}
                            type="button"
                            onClick={() => setFilterVal(chip)}
                            className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-[10px] text-zinc-300 font-mono transition-colors"
                          >
                            {chip}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="pt-2 flex justify-end gap-2">
                  <button
                    onClick={() => setIsFilterOpen(false)}
                    className="px-3 py-1.5 rounded-lg bg-zinc-800 text-xs text-zinc-300"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleApplyFilter}
                    className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white"
                  >
                    应用裁剪规则
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Column Projection Button */}
          <div className="relative">
            <button
              onClick={() => {
                setIsColumnOpen(!isColumnOpen);
                setIsFilterOpen(false);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 text-xs font-medium text-zinc-300"
            >
              <Columns className="w-3.5 h-3.5 text-zinc-400" />
              <span>
                列投影 ({visibleColumns.length}/{allColumns.length})
              </span>
            </button>

            {isColumnOpen && (
              <div className="absolute left-0 mt-2 w-64 rounded-xl bg-zinc-900 border border-zinc-700/80 shadow-2xl p-3.5 z-40 space-y-2">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-2 text-xs">
                  <span className="font-semibold text-zinc-200">Parquet 按需列读取</span>
                  <button
                    onClick={onSelectAllColumns}
                    className="text-indigo-400 hover:underline text-[11px]"
                  >
                    全选
                  </button>
                </div>
                <div className="max-h-60 overflow-y-auto space-y-1">
                  {allColumns.map((col) => {
                    const isVisible = !hiddenColumns[col.key];
                    return (
                      <label
                        key={col.key}
                        className="flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-zinc-800/70 cursor-pointer text-xs"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <input
                            type="checkbox"
                            checked={isVisible}
                            disabled={isVisible && visibleColumns.length <= 1}
                            onChange={() => onToggleColumn(col.key)}
                            className="rounded border-zinc-700 bg-zinc-950 text-indigo-500"
                          />
                          <span className="text-zinc-200 truncate">{col.label}</span>
                        </div>
                        <span className="font-mono text-[10px] text-zinc-500">{col.type}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Active Filter Badges */}
          {filters.map((f) => (
            <div
              key={f.id}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-xs text-indigo-200"
            >
              <span className="font-mono text-indigo-300">{f.field}</span>
              <span className="text-zinc-400">{operatorLabels[f.operator]?.split(' ')[0]}</span>
              <span className="font-semibold text-white">"{f.value}"</span>
              <button
                onClick={() => onRemoveFilter(f.id)}
                className="ml-1 text-indigo-300 hover:text-white"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}

          {(filters.length > 0 || globalSearch || selectedShardId !== 'ALL_SHARDS') && (
            <button
              onClick={onResetFilters}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              <span>重置全湖视图</span>
            </button>
          )}
        </div>

        {/* Direct Row Offset Jump Box */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-zinc-400">定位行号:</span>
          <input
            type="number"
            min={1}
            max={totalEstimatedRows}
            value={jumpRowInput}
            onChange={(e) => onJumpRowInputChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onJumpToRow(Number(jumpRowInput))}
            className="w-36 px-2.5 py-1 rounded-lg bg-zinc-950 border border-zinc-800 font-mono text-xs text-zinc-100 focus:outline-none focus:border-indigo-500"
          />
          <button
            onClick={() => onJumpToRow(Number(jumpRowInput))}
            className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors active:scale-95"
          >
            直达
          </button>
        </div>
      </div>
    </div>
  );
};
