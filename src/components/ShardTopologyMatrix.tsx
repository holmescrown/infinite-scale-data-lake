/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Compass, Server, CheckCircle2, ShieldAlert, Globe, X, ExternalLink, ArrowRight } from 'lucide-react';
import { StorageShard, PruningResult } from '../types/datalake.ts';

interface ShardTopologyMatrixProps {
  allShards: StorageShard[];
  pruningResult: PruningResult;
  selectedShardId: string;
  currentHitShardId: string;
  onSelectShard: (shardId: string) => void;
  onJumpToRow: (rowNum: number) => void;
}

export const ShardTopologyMatrix: React.FC<ShardTopologyMatrixProps> = ({
  allShards,
  pruningResult,
  selectedShardId,
  currentHitShardId,
  onSelectShard,
  onJumpToRow
}) => {
  const [inspectedShard, setInspectedShard] = useState<StorageShard | null>(null);
  const [matrixFilter, setMatrixFilter] = useState<'all' | 'active' | 'pruned'>('all');

  const { activeShardIds, prunedRatio } = pruningResult;

  const displayedShards = allShards.filter((s) => {
    const isActive = activeShardIds.has(s.id);
    if (matrixFilter === 'active') return isActive;
    if (matrixFilter === 'pruned') return !isActive;
    return true;
  });

  return (
    <div className="rounded-xl bg-zinc-900/60 border border-zinc-800/80 p-3.5 space-y-3">
      {/* Top Header & Shard Filter Selector */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <Compass className="w-4 h-4 text-indigo-400" />
          <span className="font-semibold text-zinc-200">分布式存储分片矩阵 (Shard Topology Matrix)</span>
          <span className="text-zinc-500 text-[11px]">
            · 共 {allShards.length} 个节点
          </span>
        </div>

        {/* Matrix Tab Filter */}
        <div className="flex items-center gap-1.5 p-1 rounded-lg bg-zinc-950 border border-zinc-800 text-[11px]">
          <button
            onClick={() => setMatrixFilter('all')}
            className={`px-2 py-0.5 rounded transition-all ${
              matrixFilter === 'all'
                ? 'bg-zinc-800 text-zinc-100 font-medium'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            全部分片 ({allShards.length})
          </button>
          <button
            onClick={() => setMatrixFilter('active')}
            className={`px-2 py-0.5 rounded transition-all flex items-center gap-1 ${
              matrixFilter === 'active'
                ? 'bg-indigo-600/30 text-indigo-200 font-medium border border-indigo-500/40'
                : 'text-indigo-400/80 hover:text-indigo-200'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
            活跃命中 ({activeShardIds.size})
          </button>
          <button
            onClick={() => setMatrixFilter('pruned')}
            className={`px-2 py-0.5 rounded transition-all flex items-center gap-1 ${
              matrixFilter === 'pruned'
                ? 'bg-zinc-800 text-zinc-300 font-medium'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
            已智能裁剪 ({allShards.length - activeShardIds.size})
          </button>
        </div>
      </div>

      {/* Interactive Micro Shards Grid */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between text-[11px] text-zinc-400">
          <span className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-400 ring-2 ring-emerald-400/40" />
              当前视窗读取中
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-indigo-500" />
              活跃候选分片 (Active)
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-zinc-800 opacity-40" />
              已裁剪跳过 (Pruned · 零网络I/O)
            </span>
          </span>
          <span className="font-mono text-zinc-300 text-[11px]">
            裁剪规避率: <strong className="text-emerald-400">{prunedRatio}%</strong>
          </span>
        </div>

        {/* Matrix Container */}
        <div className="p-2 rounded-lg bg-zinc-950/70 border border-zinc-800/70 max-h-36 overflow-y-auto">
          <div className="grid grid-cols-12 sm:grid-cols-20 md:grid-cols-30 lg:grid-cols-40 xl:grid-cols-50 gap-1">
            {displayedShards.map((s) => {
              const isActive = activeShardIds.has(s.id);
              const isCurrentHit = currentHitShardId === s.id;
              const isSelected = selectedShardId === s.id;

              return (
                <button
                  key={s.id}
                  onClick={() => setInspectedShard(s)}
                  onDoubleClick={() => onSelectShard(selectedShardId === s.id ? 'ALL_SHARDS' : s.id)}
                  title={`${s.name} @ ${s.node_origin}\n行号区间: ${s.start_row.toLocaleString()} ~ ${s.end_row.toLocaleString()} (${s.rows.toLocaleString()} 行)\n日期分区: ${s.zone_map.date_min} ~ ${s.zone_map.date_max}\n区域: ${s.zone_map.regions.join(', ')}\n批次: ${s.zone_map.batch_id}\n(双击可锁定此分片)`}
                  className={`h-4 rounded-[3px] transition-all relative group ${
                    isCurrentHit
                      ? 'bg-emerald-400 ring-2 ring-emerald-400/60 scale-110 z-10'
                      : isSelected
                      ? 'bg-amber-400 ring-2 ring-amber-400/60 z-10'
                      : isActive
                      ? 'bg-indigo-500/80 hover:bg-indigo-400 hover:scale-105'
                      : 'bg-zinc-800/40 opacity-30 hover:opacity-75'
                  }`}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Shard Node Inspector Modal / Drawer */}
      {inspectedShard && (
        <div
          onClick={() => setInspectedShard(null)}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl bg-zinc-900 border border-zinc-700/80 shadow-2xl p-5 space-y-4 text-xs"
          >
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <Server className="w-4 h-4 text-indigo-400" />
                <div>
                  <h3 className="text-sm font-semibold text-zinc-100 font-mono">
                    {inspectedShard.name}
                  </h3>
                  <p className="text-[11px] text-zinc-400 font-mono truncate max-w-[340px]">
                    {inspectedShard.node_origin}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setInspectedShard(null)}
                className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Shard Status Banner */}
            <div
              className={`p-2.5 rounded-lg border flex items-center justify-between ${
                activeShardIds.has(inspectedShard.id)
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-zinc-800/40 border-zinc-700/60 text-zinc-400'
              }`}
            >
              <div className="flex items-center gap-2">
                {activeShardIds.has(inspectedShard.id) ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <ShieldAlert className="w-4 h-4 text-zinc-500" />
                )}
                <span className="font-medium">
                  {activeShardIds.has(inspectedShard.id)
                    ? '活跃分片：已命中当前查询规则'
                    : '已智能裁剪：ZoneMap 规则未重叠，已跳过网络请求'}
                </span>
              </div>
              <span className="font-mono text-[11px]">
                {inspectedShard.sizeMB} MB
              </span>
            </div>

            {/* Shard Metadata Details */}
            <div className="space-y-2 rounded-xl bg-zinc-950 p-3.5 border border-zinc-800 font-mono text-[11px]">
              <div className="flex justify-between py-1 border-b border-zinc-800/60">
                <span className="text-zinc-500">全局行号寻址区间:</span>
                <span className="text-zinc-200">
                  #{inspectedShard.start_row.toLocaleString()} ~ #{inspectedShard.end_row.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-zinc-800/60">
                <span className="text-zinc-500">分片内总行数:</span>
                <span className="text-zinc-200 font-semibold">
                  {inspectedShard.rows.toLocaleString()} 行 ({inspectedShard.row_groups} RowGroups)
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-zinc-800/60">
                <span className="text-zinc-500">时间跨度 ZoneMap:</span>
                <span className="text-amber-300">
                  {inspectedShard.zone_map.date_min} 至 {inspectedShard.zone_map.date_max}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-zinc-800/60">
                <span className="text-zinc-500">物理批次 (Batch ID):</span>
                <span className="text-indigo-300">{inspectedShard.zone_map.batch_id}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-zinc-800/60">
                <span className="text-zinc-500">覆盖地域 (Regions):</span>
                <span className="text-zinc-200">{inspectedShard.zone_map.regions.join(', ')}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-zinc-500">业务类别 (Categories):</span>
                <span className="text-zinc-200">{inspectedShard.zone_map.categories.join(', ')}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="pt-2 flex items-center justify-between gap-2">
              <button
                onClick={() => {
                  onJumpToRow(inspectedShard.start_row);
                  setInspectedShard(null);
                }}
                className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium flex items-center gap-1.5 transition-colors"
              >
                <span>直达此分片首行</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    onSelectShard(
                      selectedShardId === inspectedShard.id ? 'ALL_SHARDS' : inspectedShard.id
                    );
                    setInspectedShard(null);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium"
                >
                  {selectedShardId === inspectedShard.id ? '取消单独锁定' : '单独过滤此分片'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
