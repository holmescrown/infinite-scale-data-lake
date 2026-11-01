/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Header } from './components/Header.tsx';
import { StorageStatsBar } from './components/StorageStatsBar.tsx';
import { ShardTopologyMatrix } from './components/ShardTopologyMatrix.tsx';
import { FilterToolbar } from './components/FilterToolbar.tsx';
import { StreamingDataGrid } from './components/StreamingDataGrid.tsx';
import { PushdownVisualizer } from './components/PushdownVisualizer.tsx';
import { MountNodeModal } from './components/MountNodeModal.tsx';
import { CatalogManifestModal } from './components/CatalogManifestModal.tsx';
import { RowDetailModal } from './components/RowDetailModal.tsx';

import {
  StorageShard,
  LakeClusterCatalog,
  PartitionFilter,
  ColumnDef,
  DecodedRow
} from './types/datalake.ts';
import {
  buildInitialCluster,
  createCustomShard,
  batchScaleCluster,
  reindexShards,
  DEFAULT_UNIVERSAL_SCHEMA
} from './engine/clusterCatalog.ts';
import { evaluatePartitionPruning } from './engine/pruner.ts';
import {
  findShardForGlobalRow,
  decodeSingleVirtualRow,
  matchesRowFilters
} from './engine/cursorDecoder.ts';
import { Check } from 'lucide-react';

export default function App() {
  // 1. Dynamic Cluster Catalog (10,000,000,000 rows default, infinite horizontally scalable)
  const [lakeCatalog, setLakeCatalog] = useState<LakeClusterCatalog>(() => buildInitialCluster(200, 50_000_000));
  const [selectedShardId, setSelectedShardId] = useState<string>('ALL_SHARDS');
  const [customMountedRows, setCustomMountedRows] = useState<any[] | null>(null);
  const [customSchema, setCustomSchema] = useState<ColumnDef[] | null>(null);

  // 2. Window Cursor Pagination State (Strict 50 or 100 rows in memory)
  const [cursorOffset, setCursorOffset] = useState<number>(0);
  const [pageSize, setPageSize] = useState<number>(50);
  const [jumpRowInput, setJumpRowInput] = useState<string>('1');

  // 3. Workspace Mode
  const [workspaceMode, setWorkspaceMode] = useState<'grid' | 'chart'>('grid');

  // 4. Search, Filtering, Projection & Sorting
  const [globalSearch, setGlobalSearch] = useState<string>('');
  const [filters, setFilters] = useState<PartitionFilter[]>([]);
  const [hiddenColumns, setHiddenColumns] = useState<Record<string, boolean>>({});
  const [sortField, setSortField] = useState<string>('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // 5. Modals & Notifications
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [inspectRow, setInspectRow] = useState<DecodedRow | null>(null);
  const [isMountModalOpen, setIsMountModalOpen] = useState<boolean>(false);
  const [isCatalogModalOpen, setIsCatalogModalOpen] = useState<boolean>(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2500);
  }, []);

  // Schema Columns
  const activeSchemaColumns = useMemo<readonly ColumnDef[]>(() => {
    return customSchema || DEFAULT_UNIVERSAL_SCHEMA;
  }, [customSchema]);

  const visibleColumns = useMemo(() => {
    return activeSchemaColumns.filter((col) => !hiddenColumns[col.key]);
  }, [activeSchemaColumns, hiddenColumns]);

  // Column projection I/O saving calculation
  const columnSavingPct = useMemo(() => {
    const totalBytes = activeSchemaColumns.reduce((acc, c) => acc + (c.bytesPerVal || 12), 0);
    const visibleBytes = visibleColumns.reduce((acc, c) => acc + (c.bytesPerVal || 12), 0);
    return totalBytes > 0
      ? Math.round(((totalBytes - visibleBytes) / totalBytes) * 100)
      : 0;
  }, [activeSchemaColumns, visibleColumns]);

  // ==========================================================================
  // PARTITION PRUNING ENGINE
  // ==========================================================================
  const pruningResult = useMemo(() => {
    return evaluatePartitionPruning(
      lakeCatalog.shards,
      filters,
      globalSearch,
      selectedShardId
    );
  }, [lakeCatalog.shards, filters, globalSearch, selectedShardId]);

  // Reset cursor to 0 when filters or selected shard change
  useEffect(() => {
    setCursorOffset(0);
    setJumpRowInput('1');
  }, [selectedShardId, filters, globalSearch]);

  // ==========================================================================
  // O(1) STREAMING WINDOW CURSOR DECODER
  // ==========================================================================
  const currentWindowData = useMemo(() => {
    const t0 = performance.now();

    // Local custom dataset path
    if (customMountedRows) {
      const filtered = customMountedRows.filter((r) =>
        matchesRowFilters(r, filters, globalSearch, visibleColumns)
      );
      const sliced = filtered.slice(cursorOffset, cursorOffset + pageSize);
      return {
        rows: sliced,
        hitShardLabel: 'local_dataset.parquet',
        hitShardId: 'local_custom',
        hitNodeOrigin: 'browser-memory.local',
        executionMs: Math.max(0.4, Math.round((performance.now() - t0) * 100) / 100),
        memoryWindowKB: Math.round(((sliced.length * visibleColumns.length * 24) / 1024) * 10) / 10
      };
    }

    const { activeShards, estimatedMatchedRows } = pruningResult;
    if (activeShards.length === 0 || estimatedMatchedRows === 0) {
      return {
        rows: [],
        hitShardLabel: 'None (All Pruned)',
        hitShardId: '',
        hitNodeOrigin: '0 节点活跃',
        executionMs: 0.2,
        memoryWindowKB: 0
      };
    }

    const windowRows: DecodedRow[] = [];
    const safeOffset = Math.min(
      Math.max(0, cursorOffset),
      Math.max(0, estimatedMatchedRows - 1)
    );

    // Map cursor offset to virtual shard in active partition set
    let cumulative = 0;
    let targetShard = activeShards[0];
    let offsetInShard = safeOffset;

    for (let i = 0; i < activeShards.length; i++) {
      const s = activeShards[i];
      if (safeOffset < cumulative + s.rows) {
        targetShard = s;
        offsetInShard = safeOffset - cumulative;
        break;
      }
      cumulative += s.rows;
      if (i === activeShards.length - 1) {
        targetShard = s;
        offsetInShard = Math.min(s.rows - 1, safeOffset - (cumulative - s.rows));
      }
    }

    // Exact ID lookup optimization
    const exactIdFilter = filters.find((f) => f.field === 'record_id' && f.operator === 'equals');
    if (exactIdFilter) {
      const numId = Number(String(exactIdFilter.value).replace(/\D/g, ''));
      if (!isNaN(numId) && numId >= targetShard.start_row && numId <= targetShard.end_row) {
        windowRows.push(decodeSingleVirtualRow(numId, targetShard));
      }
    } else {
      // Decode strictly pageSize rows without loading anything else
      let probeGlobalRow = targetShard.start_row + offsetInShard;
      let attempts = 0;
      const maxAttempts = pageSize * 40;

      while (windowRows.length < pageSize && attempts < maxAttempts) {
        attempts++;
        if (probeGlobalRow > targetShard.end_row) {
          const idx = activeShards.findIndex((s) => s.id === targetShard.id);
          if (idx >= 0 && idx + 1 < activeShards.length) {
            targetShard = activeShards[idx + 1];
            probeGlobalRow = targetShard.start_row;
          } else {
            break;
          }
        }

        const decoded = decodeSingleVirtualRow(probeGlobalRow, targetShard);
        if (matchesRowFilters(decoded, filters, globalSearch, visibleColumns)) {
          windowRows.push(decoded);
        }
        probeGlobalRow++;
      }
    }

    // Window sort
    if (sortField) {
      windowRows.sort((a, b) => {
        const va = a[sortField];
        const vb = b[sortField];
        if (va === vb) return 0;
        if (typeof va === 'number' && typeof vb === 'number') {
          return sortOrder === 'asc' ? va - vb : vb - va;
        }
        return sortOrder === 'asc'
          ? String(va).localeCompare(String(vb))
          : String(vb).localeCompare(String(va));
      });
    }

    const first = windowRows[0];
    const elapsed = Math.max(0.6, Math.round((performance.now() - t0) * 100) / 100);
    const bytesPerRow = visibleColumns.reduce((acc, c) => acc + (c.bytesPerVal || 12), 0);
    const memKB = Math.round(((windowRows.length * bytesPerRow) / 1024) * 10) / 10;

    return {
      rows: windowRows,
      hitShardLabel: first ? `${first._shard_id}.parquet` : targetShard.name,
      hitShardId: first ? first._shard_id : targetShard.id,
      hitNodeOrigin: first ? first._node_origin : targetShard.node_origin,
      executionMs: elapsed,
      memoryWindowKB: memKB
    };
  }, [
    customMountedRows,
    pruningResult,
    cursorOffset,
    pageSize,
    filters,
    globalSearch,
    visibleColumns,
    sortField,
    sortOrder
  ]);

  // ==========================================================================
  // HANDLERS FOR SCALE & DYNAMIC MOUNTING
  // ==========================================================================
  const handleJumpToRow = (targetRowOneBased: number) => {
    const maxRows = pruningResult.estimatedMatchedRows;
    const clamped = Math.max(1, Math.min(maxRows, Number(targetRowOneBased) || 1));
    setCursorOffset(clamped - 1);
    setJumpRowInput(String(clamped));
  };

  const handleMountSingleNode = (params: any) => {
    const newShard = createCustomShard(lakeCatalog.shards.length, params);
    const updated = reindexShards([...lakeCatalog.shards, newShard]);
    setLakeCatalog((prev) => ({
      ...prev,
      shards: updated,
      last_updated: new Date().toISOString()
    }));
    showToast(`成功外挂新存储节点 ${newShard.name} (+${newShard.rows.toLocaleString()} 行)`);
  };

  const handleImportManifest = (rawList: any[]) => {
    const mappedShards = rawList.map((item, idx) => ({
      id: item.id || `shard_manifest_${String(lakeCatalog.shards.length + idx + 1).padStart(4, '0')}`,
      name: item.name || `shard_manifest_${idx + 1}.parquet`,
      node_origin: item.node_origin || `https://edge-import.lake.pages.dev`,
      rows: Math.max(1, Number(item.rows) || 50_000_000),
      sizeMB: Number(item.sizeMB) || 490,
      row_groups: Number(item.row_groups) || 200,
      zone_map: item.zone_map || {
        date_min: '2026-01-01',
        date_max: '2026-12-31',
        regions: ['Zone-APAC'],
        categories: ['Telemetry'],
        batch_id: 'BATCH-IMPORT',
        metric_alpha_avg: 270,
        metric_beta_avg: 90
      }
    }));

    const combined = reindexShards([...lakeCatalog.shards, ...mappedShards]);
    setLakeCatalog((prev) => ({
      ...prev,
      shards: combined,
      last_updated: new Date().toISOString()
    }));

    const addedRows = mappedShards.reduce((a, b) => a + b.rows, 0);
    showToast(`已批量挂载 ${mappedShards.length} 个节点 (+${addedRows.toLocaleString()} 行)`);
  };

  const handleScalePreset = (addCount: number, rowsPerShard = 50_000_000) => {
    const updated = batchScaleCluster(lakeCatalog.shards, addCount, rowsPerShard);
    setLakeCatalog((prev) => ({
      ...prev,
      shards: updated,
      last_updated: new Date().toISOString()
    }));
    const addedRows = addCount * rowsPerShard;
    showToast(`已弹性扩容 +${addCount} 个节点 (+${addedRows.toLocaleString()} 行资产)`);
  };

  const handleRemoveShard = (shardId: string) => {
    const filtered = lakeCatalog.shards.filter((s) => s.id !== shardId);
    if (filtered.length === 0) return;
    const reindexed = reindexShards(filtered);
    setLakeCatalog((prev) => ({
      ...prev,
      shards: reindexed,
      last_updated: new Date().toISOString()
    }));
    if (selectedShardId === shardId) {
      setSelectedShardId('ALL_SHARDS');
    }
    showToast(`已卸载分片 ${shardId}，全湖行号已重新对齐`);
  };

  const handleResetToBaseline = () => {
    const baseline = buildInitialCluster(200, 50_000_000);
    setLakeCatalog(baseline);
    setSelectedShardId('ALL_SHARDS');
    setFilters([]);
    setGlobalSearch('');
    showToast('已重置为基准百亿行分布式数据湖 (200 节点)');
  };

  const handleExportCSV = () => {
    if (currentWindowData.rows.length === 0) return;
    const cols = visibleColumns.map((c) => c.key);
    const lines = [cols.join(',')];
    currentWindowData.rows.forEach((r) => {
      lines.push(
        cols.map((k) => `"${String(r[k] ?? '').replace(/"/g, '""')}"`).join(',')
      );
    });
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `datalake_window_offset_${cursorOffset + 1}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`已导出当前视窗 ${currentWindowData.rows.length} 行数据`);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result;
        if (typeof text !== 'string') return;

        let parsed: any[] = [];
        if (file.name.endsWith('.json')) {
          const json = JSON.parse(text);
          parsed = Array.isArray(json) ? json : json.shards || json.data || [json];
        } else {
          const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
          if (lines.length < 2) return;
          const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
          parsed = lines.slice(1).map((line) => {
            const vals = line.split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
            const obj: any = {};
            headers.forEach((h, idx) => {
              const raw = vals[idx] ?? '';
              const num = Number(raw);
              obj[h] =
                raw !== '' && !isNaN(num)
                  ? num
                  : raw === 'true'
                  ? true
                  : raw === 'false'
                  ? false
                  : raw;
            });
            return obj;
          });
        }

        if (parsed.length > 0) {
          const sample = parsed[0];
          const inferred: ColumnDef[] = Object.keys(sample).map((k) => {
            const v = sample[k];
            const type =
              typeof v === 'number'
                ? 'number'
                : typeof v === 'boolean'
                ? 'boolean'
                : /^\d{4}-\d{2}-\d{2}/.test(String(v))
                ? 'date'
                : 'string';
            return { key: k, label: k, type, bytesPerVal: 12 };
          });
          setCustomSchema(inferred);
          setCustomMountedRows(parsed);
          setCursorOffset(0);
          showToast(`已加载本地数据集 ${file.name} (${parsed.length.toLocaleString()} 行)`);
        }
      } catch (err) {
        showToast('解析文件失败，请检查 CSV/JSON 格式');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleCopyText = (text: string, label: string) => {
    navigator.clipboard?.writeText(text);
    showToast(`已复制 ${label}: "${text.length > 30 ? text.slice(0, 30) + '...' : text}"`);
  };

  return (
    <div className="min-h-screen w-full bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-indigo-500/30">
      {/* 1. Top Bar */}
      <Header
        totalRows={pruningResult.totalClusterRows}
        totalShards={lakeCatalog.shards.length}
        onOpenMountModal={() => setIsMountModalOpen(true)}
        onOpenCatalogModal={() => setIsCatalogModalOpen(true)}
        onExportCSV={handleExportCSV}
        onImportLocalFileClick={() => fileInputRef.current?.click()}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.json"
        onChange={handleFileUpload}
        className="hidden"
      />

      {/* 2. Main Workspace */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-4 space-y-3.5">
        {/* Custom file notice if active */}
        {customMountedRows && (
          <div className="px-4 py-2 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-between text-xs text-amber-300">
            <span>当前正在查看本地导入的数据表 ({customMountedRows.length.toLocaleString()} 行)</span>
            <button
              onClick={() => {
                setCustomMountedRows(null);
                setCustomSchema(null);
                showToast('已切回百亿/千亿级分布式数据湖主集群');
              }}
              className="px-2.5 py-1 rounded-md bg-amber-500/20 hover:bg-amber-500/30 font-medium"
            >
              切回分布式全湖视图
            </button>
          </div>
        )}

        {/* Dynamic Capacity KPI Cards */}
        <StorageStatsBar
          pruningResult={pruningResult}
          windowRowCount={currentWindowData.rows.length}
          windowMemoryKB={currentWindowData.memoryWindowKB}
          hitShardLabel={currentWindowData.hitShardLabel}
          executionMs={currentWindowData.executionMs}
          columnSavingPct={columnSavingPct}
        />

        {/* Shard Topology Matrix Bar */}
        <ShardTopologyMatrix
          allShards={lakeCatalog.shards}
          pruningResult={pruningResult}
          selectedShardId={selectedShardId}
          currentHitShardId={currentWindowData.hitShardId}
          onSelectShard={(id) => setSelectedShardId(id)}
          onJumpToRow={handleJumpToRow}
        />

        {/* Filters, Projection & Navigation Bar */}
        <FilterToolbar
          allShards={lakeCatalog.shards}
          selectedShardId={selectedShardId}
          onSelectShard={(id) => setSelectedShardId(id)}
          globalSearch={globalSearch}
          onSearchChange={setGlobalSearch}
          filters={filters}
          onAddFilter={(newF) =>
            setFilters((prev) => [...prev, { ...newF, id: `flt_${Date.now()}` }])
          }
          onRemoveFilter={(id) => setFilters((prev) => prev.filter((f) => f.id !== id))}
          onResetFilters={() => {
            setFilters([]);
            setGlobalSearch('');
            setSelectedShardId('ALL_SHARDS');
            setCursorOffset(0);
          }}
          allColumns={activeSchemaColumns}
          visibleColumns={visibleColumns}
          hiddenColumns={hiddenColumns}
          onToggleColumn={(key) =>
            setHiddenColumns((prev) => ({ ...prev, [key]: !prev[key] }))
          }
          onSelectAllColumns={() => setHiddenColumns({})}
          jumpRowInput={jumpRowInput}
          onJumpRowInputChange={setJumpRowInput}
          onJumpToRow={handleJumpToRow}
          totalEstimatedRows={pruningResult.estimatedMatchedRows}
          workspaceMode={workspaceMode}
          onSetWorkspaceMode={setWorkspaceMode}
          pageSize={pageSize}
        />

        {/* Workspace View Mode: Streaming Data Grid vs Pushdown Visualizer */}
        {workspaceMode === 'grid' ? (
          <StreamingDataGrid
            rows={currentWindowData.rows}
            visibleColumns={visibleColumns}
            cursorOffset={cursorOffset}
            pageSize={pageSize}
            onPageSizeChange={setPageSize}
            totalEstimatedRows={pruningResult.estimatedMatchedRows}
            hitShardLabel={currentWindowData.hitShardLabel}
            hitNodeOrigin={currentWindowData.hitNodeOrigin}
            sortField={sortField}
            sortOrder={sortOrder}
            onSortColumn={(key) => {
              if (sortField !== key) {
                setSortField(key);
                setSortOrder('asc');
              } else if (sortOrder === 'asc') {
                setSortOrder('desc');
              } else {
                setSortField('');
                setSortOrder('asc');
              }
            }}
            selectedRowId={selectedRowId}
            onSelectRow={setSelectedRowId}
            onInspectRow={setInspectRow}
            onJumpToRow={handleJumpToRow}
            onCopyText={handleCopyText}
          />
        ) : (
          <PushdownVisualizer
            activeShards={pruningResult.activeShards}
            totalEstimatedRows={pruningResult.estimatedMatchedRows}
            schemaColumns={activeSchemaColumns}
          />
        )}
      </main>

      {/* Dynamic Mount & Scale Modal */}
      <MountNodeModal
        isOpen={isMountModalOpen}
        onClose={() => setIsMountModalOpen(false)}
        allShards={lakeCatalog.shards}
        onMountSingleNode={handleMountSingleNode}
        onImportManifest={handleImportManifest}
        onScalePreset={handleScalePreset}
        onRemoveShard={handleRemoveShard}
        onResetToBaseline={handleResetToBaseline}
      />

      {/* Catalog JSON Manifest Modal */}
      <CatalogManifestModal
        isOpen={isCatalogModalOpen}
        onClose={() => setIsCatalogModalOpen(false)}
        allShards={lakeCatalog.shards}
        lakeName={lakeCatalog.lake_name}
        totalRows={pruningResult.totalClusterRows}
        totalMB={pruningResult.totalClusterMB}
        onCopyText={handleCopyText}
      />

      {/* Single Row Detail Modal */}
      <RowDetailModal
        row={inspectRow}
        onClose={() => setInspectRow(null)}
        columns={activeSchemaColumns}
        onCopyText={handleCopyText}
      />

      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 px-3.5 py-2 rounded-xl bg-zinc-900 border border-indigo-500/40 text-xs text-zinc-100 shadow-2xl animate-in fade-in">
          <Check className="w-3.5 h-3.5 text-emerald-400" />
          <span>{toastMsg}</span>
        </div>
      )}
    </div>
  );
}
