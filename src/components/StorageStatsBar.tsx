/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Layers, Server, HardDrive, ShieldCheck, Cpu } from 'lucide-react';
import { PruningResult } from '../types/datalake.ts';

interface StorageStatsBarProps {
  pruningResult: PruningResult;
  windowRowCount: number;
  windowMemoryKB: number;
  hitShardLabel: string;
  executionMs: number;
  columnSavingPct: number;
}

export const StorageStatsBar: React.FC<StorageStatsBarProps> = ({
  pruningResult,
  windowRowCount,
  windowMemoryKB,
  hitShardLabel,
  executionMs,
  columnSavingPct
}) => {
  const {
    totalClusterRows,
    totalClusterMB,
    activeShards,
    prunedShardsCount,
    prunedRatio,
    estimatedMatchedRows
  } = pruningResult;

  const totalShards = activeShards.length + prunedShardsCount;
  const storageGB = (totalClusterMB / 1024).toFixed(1);

  return (
    <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
      {/* Metric 1: Dynamic Total Rows */}
      <div className="p-3.5 rounded-xl bg-zinc-900/50 border border-zinc-800/80 flex flex-col justify-between">
        <div className="flex items-center justify-between text-zinc-400">
          <span className="text-xs font-medium">全湖总行数 (Dynamic Rows)</span>
          <Layers className="w-4 h-4 text-indigo-400" />
        </div>
        <div className="my-1.5">
          <div className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-zinc-100 tracking-tight">
            {totalClusterRows.toLocaleString()}
          </div>
        </div>
        <div className="text-[11px] text-zinc-500 truncate">
          当前命中:{' '}
          <span className="text-indigo-400 font-mono font-semibold tabular-nums">
            {estimatedMatchedRows.toLocaleString()}
          </span>{' '}
          行
        </div>
      </div>

      {/* Metric 2: Dynamic Storage Shards */}
      <div className="p-3.5 rounded-xl bg-zinc-900/50 border border-zinc-800/80 flex flex-col justify-between">
        <div className="flex items-center justify-between text-zinc-400">
          <span className="text-xs font-medium">存储节点切片 (Shards)</span>
          <Server className="w-4 h-4 text-sky-400" />
        </div>
        <div className="my-1.5 flex items-baseline gap-2">
          <span className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-zinc-100">
            {totalShards}
          </span>
          <span className="text-xs font-mono text-emerald-400">
            活跃 {activeShards.length}
          </span>
        </div>
        <div className="text-[11px] text-zinc-500 truncate">
          自动裁剪跳过{' '}
          <span className="text-zinc-300 font-mono tabular-nums">
            {prunedShardsCount}
          </span>{' '}
          个无关切片
        </div>
      </div>

      {/* Metric 3: Total Storage Capacity */}
      <div className="p-3.5 rounded-xl bg-zinc-900/50 border border-zinc-800/80 flex flex-col justify-between">
        <div className="flex items-center justify-between text-zinc-400">
          <span className="text-xs font-medium">注册总存储容量 (Storage)</span>
          <HardDrive className="w-4 h-4 text-amber-400" />
        </div>
        <div className="my-1.5 flex items-baseline gap-2">
          <span className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-zinc-100">
            {storageGB} GB
          </span>
          <span className="text-xs font-mono text-amber-400/90">
            {(totalClusterMB / Math.max(1, totalShards)).toFixed(0)} MB/片
          </span>
        </div>
        <div className="text-[11px] text-zinc-500 truncate">
          列投影裁剪规避 <span className="text-emerald-400 font-mono">{columnSavingPct}%</span> I/O
        </div>
      </div>

      {/* Metric 4: Partition Pruning Efficiency */}
      <div className="p-3.5 rounded-xl bg-zinc-900/50 border border-zinc-800/80 flex flex-col justify-between">
        <div className="flex items-center justify-between text-zinc-400">
          <span className="text-xs font-medium">智能分区裁剪效能 (Pruning)</span>
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
        </div>
        <div className="my-1.5 flex items-baseline gap-2">
          <span className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-emerald-400">
            {prunedRatio}%
          </span>
          <span className="text-xs text-zinc-400">网络 I/O 规避</span>
        </div>
        <div className="text-[11px] text-zinc-500 truncate">
          并发严格限制在{' '}
          <span className="text-indigo-400 font-mono">{activeShards.length}</span> 个活跃分片
        </div>
      </div>

      {/* Metric 5: Zero-OOM Streaming Window */}
      <div className="p-3.5 rounded-xl bg-zinc-900/50 border border-zinc-800/80 flex flex-col justify-between">
        <div className="flex items-center justify-between text-zinc-400">
          <span className="text-xs font-medium">流式视窗内存 (Zero-OOM)</span>
          <Cpu className="w-4 h-4 text-purple-400" />
        </div>
        <div className="my-1.5 flex items-baseline gap-2">
          <span className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-purple-300">
            {windowRowCount} 行
          </span>
          <span className="text-xs font-mono text-zinc-400">
            ({windowMemoryKB} KB)
          </span>
        </div>
        <div className="text-[11px] text-zinc-500 truncate">
          定位: <span className="text-zinc-300 font-mono">{hitShardLabel}</span> ({executionMs}ms)
        </div>
      </div>
    </section>
  );
};
