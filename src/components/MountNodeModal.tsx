/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  X,
  Server,
  FileJson,
  Zap,
  Check,
  Upload,
  Trash2,
  RotateCcw,
  Globe,
  ExternalLink
} from 'lucide-react';
import { StorageShard } from '../types/datalake.ts';
import { PARTITION_REGIONS, CATEGORY_DICTIONARY, BATCH_IDS } from '../engine/clusterCatalog.ts';

interface MountNodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  allShards: StorageShard[];
  onMountSingleNode: (params: {
    nodeOrigin: string;
    shardName?: string;
    rows?: number;
    sizeMB?: number;
    region?: string;
    category?: string;
    batchId?: string;
    dateMin?: string;
    dateMax?: string;
  }) => void;
  onImportManifest: (shardsData: any[]) => void;
  onScalePreset: (count: number, rowsPerShard?: number) => void;
  onRemoveShard: (shardId: string) => void;
  onResetToBaseline: () => void;
}

export const MountNodeModal: React.FC<MountNodeModalProps> = ({
  isOpen,
  onClose,
  allShards,
  onMountSingleNode,
  onImportManifest,
  onScalePreset,
  onRemoveShard,
  onResetToBaseline
}) => {
  const [activeTab, setActiveTab] = useState<'single' | 'manifest' | 'presets' | 'manage'>('presets');

  // Single Node Form State
  const [nodeOrigin, setNodeOrigin] = useState('https://node-edge-custom.lake.pages.dev');
  const [shardName, setShardName] = useState('shard_custom_edge.parquet');
  const [rowsCount, setRowsCount] = useState(50_000_000);
  const [sizeMB, setSizeMB] = useState(490);
  const [region, setRegion] = useState('Zone-APAC');
  const [category, setCategory] = useState('Telemetry');
  const [batchId, setBatchId] = useState('BATCH-2026-Q3');
  const [dateMin, setDateMin] = useState('2026-07-01');
  const [dateMax, setDateMax] = useState('2026-07-15');

  // Manifest Form State
  const [manifestText, setManifestText] = useState('');
  const [manifestError, setManifestError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSingleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nodeOrigin.trim()) return;
    onMountSingleNode({
      nodeOrigin: nodeOrigin.trim(),
      shardName: shardName.trim() || undefined,
      rows: Number(rowsCount) || 50_000_000,
      sizeMB: Number(sizeMB) || 490,
      region,
      category,
      batchId,
      dateMin,
      dateMax
    });
    onClose();
  };

  const handleManifestSubmit = () => {
    setManifestError(null);
    try {
      const parsed = JSON.parse(manifestText);
      const list = Array.isArray(parsed) ? parsed : parsed.shards || parsed.nodes || [parsed];
      if (!Array.isArray(list) || list.length === 0) {
        setManifestError('未能识别有效的切片清单，请检查 JSON 数组或 shards 字段。');
        return;
      }
      onImportManifest(list);
      setManifestText('');
      onClose();
    } catch (err: any) {
      setManifestError(`JSON 解析失败: ${err.message}`);
    }
  };

  const handleSampleManifest = () => {
    const sample = [
      {
        id: `shard_edge_sg01`,
        name: `shard_edge_sg01.parquet`,
        node_origin: `https://singapore-edge.lake.pages.dev`,
        rows: 50_000_000,
        sizeMB: 495,
        zone_map: {
          regions: ['Zone-APAC'],
          categories: ['Finance'],
          batch_id: 'BATCH-2026-EXP',
          date_min: '2026-08-01',
          date_max: '2026-08-15'
        }
      },
      {
        id: `shard_edge_ty01`,
        name: `shard_edge_ty01.parquet`,
        node_origin: `https://tokyo-edge.lake.pages.dev`,
        rows: 50_000_000,
        sizeMB: 488,
        zone_map: {
          regions: ['Zone-APAC'],
          categories: ['Telemetry'],
          batch_id: 'BATCH-2026-EXP',
          date_min: '2026-08-16',
          date_max: '2026-08-31'
        }
      }
    ];
    setManifestText(JSON.stringify(sample, null, 2));
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-2xl bg-zinc-900 border border-zinc-700/80 shadow-2xl p-5 space-y-4 text-xs"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-indigo-400" />
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">
                动态外挂节点与无限横向扩展 (Infinite Horizontal Scaling)
              </h2>
              <p className="text-[11px] text-zinc-400">
                容量完全脱钩：严禁硬编码，全湖规模随挂载节点动态累加，平滑支撑百亿、千亿行
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-zinc-800 pb-1">
          {[
            { id: 'presets', label: '一键弹性扩容预设', icon: Zap },
            { id: 'single', label: '接入单个 Cloudflare 节点', icon: Globe },
            { id: 'manifest', label: '批量导入 JSON 清单', icon: FileJson },
            { id: 'manage', label: `节点管理 (${allShards.length})`, icon: Server }
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all ${
                  activeTab === tab.id
                    ? 'bg-zinc-800 text-zinc-100 border border-zinc-700'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5 text-indigo-400" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab 1: Presets (1B, 5B, 50B / 100B Scale Test) */}
        {activeTab === 'presets' && (
          <div className="space-y-4 py-1">
            <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-200 text-xs">
              <strong>千亿级压力测试方案：</strong>
              当前集群已注册 <strong>{allShards.length}</strong> 个节点，总计{' '}
              <strong>{allShards.reduce((a, b) => a + b.rows, 0).toLocaleString()}</strong> 行。
              点击下方弹性扩容预设，系统将自动追加带真实 ZoneMap 边界的大批量边缘分片并刷新大屏。
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Preset 1 */}
              <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 flex flex-col justify-between space-y-2">
                <div>
                  <div className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    +10 亿行资产 (+1B)
                  </div>
                  <p className="text-[11px] text-zinc-400 mt-1">
                    追加 20 个 Cloudflare Pages 存储节点，每个分片 5,000 万行。
                  </p>
                </div>
                <button
                  onClick={() => {
                    onScalePreset(20, 50_000_000);
                    onClose();
                  }}
                  className="w-full py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-medium transition-colors"
                >
                  挂载 +20 节点
                </button>
              </div>

              {/* Preset 2 */}
              <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 flex flex-col justify-between space-y-2">
                <div>
                  <div className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-sky-400" />
                    +50 亿行资产 (+5B)
                  </div>
                  <p className="text-[11px] text-zinc-400 mt-1">
                    追加 100 个分布式边缘存储节点，跨 7 大 Zone 区域网格。
                  </p>
                </div>
                <button
                  onClick={() => {
                    onScalePreset(100, 50_000_000);
                    onClose();
                  }}
                  className="w-full py-1.5 rounded-lg bg-indigo-600/80 hover:bg-indigo-600 text-white font-medium transition-colors"
                >
                  挂载 +100 节点
                </button>
              </div>

              {/* Preset 3 */}
              <div className="p-3.5 rounded-xl bg-zinc-950 border border-indigo-500/40 shadow-lg flex flex-col justify-between space-y-2">
                <div>
                  <div className="text-xs font-semibold text-indigo-300 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
                    +500 亿行超大规模 (+50B)
                  </div>
                  <p className="text-[11px] text-zinc-400 mt-1">
                    追加 1,000 个边缘节点，直冲千亿行大数据湖资产上限压测。
                  </p>
                </div>
                <button
                  onClick={() => {
                    onScalePreset(1000, 50_000_000);
                    onClose();
                  }}
                  className="w-full py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors shadow-md"
                >
                  挂载 +1,000 节点 (千亿行)
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Single Node Form */}
        {activeTab === 'single' && (
          <form onSubmit={handleSingleSubmit} className="space-y-3 py-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-zinc-400 text-[11px] mb-1">
                  Cloudflare Pages 节点 Origin URL
                </label>
                <input
                  type="text"
                  required
                  value={nodeOrigin}
                  onChange={(e) => setNodeOrigin(e.target.value)}
                  placeholder="https://node-xxx.lake.pages.dev"
                  className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-200 font-mono"
                />
              </div>

              <div>
                <label className="block text-zinc-400 text-[11px] mb-1">切片文件名</label>
                <input
                  type="text"
                  value={shardName}
                  onChange={(e) => setShardName(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-200 font-mono"
                />
              </div>

              <div>
                <label className="block text-zinc-400 text-[11px] mb-1">切片行数 (Rows)</label>
                <input
                  type="number"
                  min={1}
                  value={rowsCount}
                  onChange={(e) => setRowsCount(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-200 font-mono"
                />
              </div>

              <div>
                <label className="block text-zinc-400 text-[11px] mb-1">主地域分区 (Zone)</label>
                <select
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-200"
                >
                  {PARTITION_REGIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-zinc-400 text-[11px] mb-1">业务类别 (Category)</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-200"
                >
                  {CATEGORY_DICTIONARY.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-zinc-400 text-[11px] mb-1">起始时间 (ZoneMap Date Min)</label>
                <input
                  type="date"
                  value={dateMin}
                  onChange={(e) => setDateMin(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-200"
                />
              </div>

              <div>
                <label className="block text-zinc-400 text-[11px] mb-1">结束时间 (ZoneMap Date Max)</label>
                <input
                  type="date"
                  value={dateMax}
                  onChange={(e) => setDateMax(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-200"
                />
              </div>
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300"
              >
                取消
              </button>
              <button
                type="submit"
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium"
              >
                外挂并注册节点
              </button>
            </div>
          </form>
        )}

        {/* Tab 3: Manifest Import */}
        {activeTab === 'manifest' && (
          <div className="space-y-3 py-1">
            <div className="flex items-center justify-between">
              <label className="text-zinc-400 text-[11px]">
                粘贴切片清单 JSON (包含 node_origin, rows, zone_map)
              </label>
              <button
                type="button"
                onClick={handleSampleManifest}
                className="text-indigo-400 hover:underline text-[11px]"
              >
                填入示例清单
              </button>
            </div>

            <textarea
              rows={8}
              value={manifestText}
              onChange={(e) => setManifestText(e.target.value)}
              placeholder={'[{\n  "name": "shard_apac.parquet",\n  "node_origin": "https://apac.lake.pages.dev",\n  "rows": 50000000\n}]'}
              className="w-full p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 font-mono text-zinc-200 text-xs focus:outline-none focus:border-indigo-500"
            />

            {manifestError && (
              <div className="p-2 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-[11px]">
                {manifestError}
              </div>
            )}

            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleManifestSubmit}
                disabled={!manifestText.trim()}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-medium"
              >
                批量导入并扩展数据湖
              </button>
            </div>
          </div>
        )}

        {/* Tab 4: Manage & Unmount Shards */}
        {activeTab === 'manage' && (
          <div className="space-y-3 py-1">
            <div className="flex items-center justify-between">
              <span className="text-zinc-400 text-[11px]">
                当前已接入 {allShards.length} 个存储节点切片
              </span>
              <button
                type="button"
                onClick={() => {
                  onResetToBaseline();
                  onClose();
                }}
                className="flex items-center gap-1 text-xs text-amber-400 hover:underline"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>重置为基准百亿集群 (200 节点)</span>
              </button>
            </div>

            <div className="max-h-64 overflow-y-auto rounded-lg border border-zinc-800 divide-y divide-zinc-800/60 font-mono text-[11px]">
              {allShards.map((s) => (
                <div
                  key={s.id}
                  className="p-2 flex items-center justify-between hover:bg-zinc-800/40"
                >
                  <div className="truncate max-w-[360px]">
                    <div className="text-zinc-200 font-semibold truncate">
                      {s.name} · <span className="text-indigo-400">{s.rows.toLocaleString()} 行</span>
                    </div>
                    <div className="text-zinc-500 text-[10px] truncate">{s.node_origin}</div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-zinc-400">{s.sizeMB} MB</span>
                    <button
                      onClick={() => onRemoveShard(s.id)}
                      disabled={allShards.length <= 1}
                      className="p-1 rounded text-zinc-500 hover:text-red-400 transition-colors disabled:opacity-20"
                      title="卸载此存储分片"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
