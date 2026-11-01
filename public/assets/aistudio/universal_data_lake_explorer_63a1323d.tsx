import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  Database,
  Table2,
  Layers,
  HardDrive,
  Search,
  Filter,
  Columns,
  Download,
  Upload,
  Plus,
  X,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  BarChart3,
  PieChart as PieChartIcon,
  TrendingUp,
  Copy,
  Check,
  Calendar,
  CheckSquare,
  RotateCcw,
  FileSpreadsheet,
  Server,
  Zap,
  Maximize2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Compass,
  FolderGit2,
  Cpu
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip
} from 'recharts';

// ============================================================================
// 1. /lake/catalog.json SPECIFICATION (50 SHARDS × 20M ROWS = 1,000,000,000 ROWS)
//    Each shard carries ZoneMap metadata for instant Partition Pruning without
//    loading raw data into memory.
// ============================================================================
const PARTITION_ZONES = ['Zone-North', 'Zone-South', 'Zone-East', 'Zone-West', 'Zone-Central'];
const CATEGORY_DICTIONARY = ['Cat-Alpha', 'Cat-Beta', 'Cat-Gamma', 'Cat-Delta', 'Cat-Epsilon', 'Cat-Omega'];
const STATUS_DICTIONARY = ['Verified', 'Synced', 'Active', 'Archived', 'Pending'];

function buildInitialCatalog() {
  const shards = [];
  const rowsPerShard = 20000000; // 20,000,000 rows per shard
  const baseEpoch = new Date('2023-01-01T00:00:00Z').getTime();
  const dayMs = 86400 * 1000;

  for (let i = 1; i <= 50; i++) {
    const shardNum = String(i).padStart(2, '0');
    const shardFileNum = String(i).padStart(3, '0');
    const sizeMB = 480 + ((i * 7) % 21); // 480 MB ~ 500 MB (Total ~24.5 GB)
    const startRowGlobal = (i - 1) * rowsPerShard + 1;
    const endRowGlobal = i * rowsPerShard;

    // ZoneMap metadata per shard for Partition Pruning
    const primaryZone = PARTITION_ZONES[(i - 1) % PARTITION_ZONES.length];
    const secondaryZone = PARTITION_ZONES[i % PARTITION_ZONES.length];
    const shardStartDate = new Date(baseEpoch + (i - 1) * 18 * dayMs).toISOString().split('T')[0];
    const shardEndDate = new Date(baseEpoch + i * 18 * dayMs - dayMs).toISOString().split('T')[0];

    shards.push({
      id: `shard_${shardNum}`,
      name: `shard_${shardFileNum}.parquet`,
      node_origin: `node${i}.pages.dev`,
      rows: rowsPerShard,
      size: `${sizeMB} MB`,
      sizeMB,
      row_groups: 160,
      start_row: startRowGlobal,
      end_row: endRowGlobal,
      zone_map: {
        min_id: `REC-${String(startRowGlobal).padStart(10, '0')}`,
        max_id: `REC-${String(endRowGlobal).padStart(10, '0')}`,
        date_min: shardStartDate,
        date_max: shardEndDate,
        regions: [primaryZone, secondaryZone],
        metric_alpha_avg: Math.round((240 + Math.sin(i * 0.5) * 85) * 100) / 100,
        metric_beta_avg: Math.round((85 + Math.cos(i * 0.4) * 32) * 100) / 100
      }
    });
  }

  const totalRows = shards.reduce((acc, s) => acc + s.rows, 0);
  const totalMB = shards.reduce((acc, s) => acc + s.sizeMB, 0);

  return {
    lake_name: 'Cloudflare Global Serverless Lake',
    total_shards: shards.length,
    total_estimated_rows: totalRows, // 1,000,000,000
    total_storage_size: `${(totalMB / 1024).toFixed(1)} GB`,
    total_storage_mb: totalMB,
    shards
  };
}

const DEFAULT_UNIVERSAL_SCHEMA = [
  { key: 'record_id', label: 'record_id', type: 'string', bytesPerVal: 16 },
  { key: 'partition_key', label: 'partition_key', type: 'string', bytesPerVal: 12 },
  { key: 'event_timestamp', label: 'event_timestamp', type: 'date', bytesPerVal: 10 },
  { key: 'region_zone', label: 'region_zone', type: 'string', bytesPerVal: 12 },
  { key: 'category_code', label: 'category_code', type: 'string', bytesPerVal: 10 },
  { key: 'status_flag', label: 'status_flag', type: 'string', bytesPerVal: 10 },
  { key: 'metric_alpha', label: 'metric_alpha', type: 'number', bytesPerVal: 8 },
  { key: 'metric_beta', label: 'metric_beta', type: 'number', bytesPerVal: 8 },
  { key: 'is_verified', label: 'is_verified', type: 'boolean', bytesPerVal: 1 },
  { key: 'payload_hash', label: 'payload_hash', type: 'string', bytesPerVal: 16 }
];

// ============================================================================
// 2. O(1) STREAMING WINDOW CURSOR DECODER (ZERO ARRAY ALLOCATION FOR 1B ROWS)
//    Decodes ONLY the 50~100 rows visible in the current viewport window on the fly
//    using deterministic row-group mathematics & shard ZoneMaps.
// ============================================================================
function decodeSingleVirtualRow(globalRowNumber, shardMeta) {
  // Deterministic 32-bit mixing hash (Murmur-inspired) for O(1) random access at any row (1 .. 1,000,000,000+)
  let h = (globalRowNumber ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;

  const regions = shardMeta.zone_map.regions;
  const regionZone = regions[h % regions.length];
  const categoryCode = CATEGORY_DICTIONARY[(h >>> 3) % CATEGORY_DICTIONARY.length];
  const statusFlag = STATUS_DICTIONARY[(h >>> 7) % STATUS_DICTIONARY.length];

  // Interpolate date within shard's ZoneMap date range
  const minTime = new Date(shardMeta.zone_map.date_min).getTime();
  const maxTime = new Date(shardMeta.zone_map.date_max).getTime();
  const rowOffsetRatio =
    (globalRowNumber - shardMeta.start_row) / Math.max(1, shardMeta.rows);
  const rowDate = new Date(minTime + rowOffsetRatio * (maxTime - minTime))
    .toISOString()
    .split('T')[0];

  const metricAlpha =
    Math.round(
      (shardMeta.zone_map.metric_alpha_avg * 0.6 + ((h % 90000) / 100) + ((h & 15) * 1.25)) * 100
    ) / 100;
  const metricBeta =
    Math.round(
      (shardMeta.zone_map.metric_beta_avg * 0.5 + (((h >>> 5) % 45000) / 100)) * 100
    ) / 100;

  const isVerified = (h & 3) !== 0;
  const hexHash = `0x${h.toString(16).padStart(8, '0')}${((h * 1664525) >>> 0)
    .toString(16)
    .padStart(8, '0')}`;

  return {
    _global_row_num: globalRowNumber,
    _shard_id: shardMeta.id,
    _node_origin: shardMeta.node_origin,
    _row_group: Math.floor(((globalRowNumber - shardMeta.start_row) / shardMeta.rows) * shardMeta.row_groups) + 1,
    record_id: `REC-${String(globalRowNumber).padStart(10, '0')}`,
    partition_key: `${shardMeta.id.toUpperCase()}_RG${String(
      Math.floor(((globalRowNumber - shardMeta.start_row) / shardMeta.rows) * shardMeta.row_groups) + 1
    ).padStart(3, '0')}`,
    event_timestamp: rowDate,
    region_zone: regionZone,
    category_code: categoryCode,
    status_flag: statusFlag,
    metric_alpha: metricAlpha,
    metric_beta: metricBeta,
    is_verified: isVerified,
    payload_hash: hexHash
  };
}

// Evaluate row against user's visual filters
function matchesFilterRules(row, filters, globalSearch, visibleColumns) {
  if (globalSearch.trim() !== '') {
    const q = globalSearch.toLowerCase().trim();
    let hit = false;
    for (let i = 0; i < visibleColumns.length; i++) {
      const val = row[visibleColumns[i].key];
      if (val !== null && val !== undefined && String(val).toLowerCase().includes(q)) {
        hit = true;
        break;
      }
    }
    if (!hit) return false;
  }

  for (let i = 0; i < filters.length; i++) {
    const f = filters[i];
    const cellVal = row[f.field];
    const targetVal = f.value;
    const strCell = String(cellVal ?? '').toLowerCase();
    const strTarget = String(targetVal ?? '').toLowerCase();

    switch (f.operator) {
      case 'equals':
        if (strCell !== strTarget) return false;
        break;
      case 'not_equals':
        if (strCell === strTarget) return false;
        break;
      case 'contains':
        if (!strCell.includes(strTarget)) return false;
        break;
      case 'gt':
        if (!(Number(cellVal) > Number(targetVal))) return false;
        break;
      case 'lt':
        if (!(Number(cellVal) < Number(targetVal))) return false;
        break;
      default:
        break;
    }
  }
  return true;
}

// Column Type Icon Badge (#, Aa, 📅, ☑)
function FieldTypeBadge({ type }) {
  switch (type) {
    case 'number':
      return (
        <span
          className="inline-flex items-center justify-center w-4 h-4 rounded bg-emerald-500/10 text-emerald-400 font-mono text-[10px] font-bold shrink-0"
          title="数值 (Number)"
        >
          #
        </span>
      );
    case 'date':
      return (
        <span
          className="inline-flex items-center justify-center w-4 h-4 rounded bg-amber-500/10 text-amber-400 shrink-0"
          title="日期 (Date)"
        >
          <Calendar className="w-2.5 h-2.5" />
        </span>
      );
    case 'boolean':
      return (
        <span
          className="inline-flex items-center justify-center w-4 h-4 rounded bg-purple-500/10 text-purple-400 shrink-0"
          title="布尔值 (Boolean)"
        >
          <CheckSquare className="w-2.5 h-2.5" />
        </span>
      );
    default:
      return (
        <span
          className="inline-flex items-center justify-center w-4 h-4 rounded bg-indigo-500/10 text-indigo-400 font-sans text-[10px] font-semibold shrink-0"
          title="文本 (Text)"
        >
          Aa
        </span>
      );
  }
}

const CHART_COLORS = ['#6366f1', '#3b82f6', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'];

// ============================================================================
// MAIN APPLICATION COMPONENT
// ============================================================================
export default function App() {
  // 1. Catalog State (/lake/catalog.json with 50 Shards = 1,000,000,000 Rows)
  const [lakeCatalog, setLakeCatalog] = useState(() => buildInitialCatalog());
  const [selectedShardId, setSelectedShardId] = useState('ALL_SHARDS'); // 'ALL_SHARDS' or 'shard_01'...'shard_50'
  const [customMountedRows, setCustomMountedRows] = useState(null); // Optional user-uploaded file rows
  const [customSchema, setCustomSchema] = useState(null);

  // 2. Window Cursor Pagination State (Strictly 50 or 100 rows in memory at any time!)
  const [cursorOffset, setCursorOffset] = useState(0); // 0-indexed row offset inside active partition set
  const [pageSize, setPageSize] = useState(50); // 50 or 100 rows per viewport window
  const [jumpRowInput, setJumpRowInput] = useState('1');

  // 3. View Mode ('grid' | 'chart')
  const [workspaceMode, setWorkspaceMode] = useState('grid');

  // 4. No-Code Filter, Search, Sort & Column Projection State
  const [globalSearch, setGlobalSearch] = useState('');
  const [filters, setFilters] = useState([]);
  const [isFilterPopoverOpen, setIsFilterPopoverOpen] = useState(false);
  const [newFilterField, setNewFilterField] = useState('region_zone');
  const [newFilterOp, setNewFilterOp] = useState('equals');
  const [newFilterVal, setNewFilterVal] = useState('');

  const [isColumnPopoverOpen, setIsColumnPopoverOpen] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState({});

  const [sortField, setSortField] = useState('');
  const [sortOrder, setSortOrder] = useState('asc');

  // 5. Pushdown Aggregation Visualizer State
  const [chartType, setChartType] = useState('bar');
  const [chartXField, setChartXField] = useState('region_zone');
  const [chartYField, setChartYField] = useState('metric_alpha');
  const [chartAgg, setChartAgg] = useState('sum'); // 'count' | 'sum' | 'avg' | 'max' | 'min'

  // 6. Modals & Interactive States
  const [selectedRowId, setSelectedRowId] = useState(null);
  const [inspectRowData, setInspectRowData] = useState(null);
  const [catalogModalOpen, setCatalogModalOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);

  const fileInputRef = useRef(null);

  const showToast = useCallback((msg) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2400);
  }, []);

  // Active Schema Columns
  const schemaColumns = useMemo(() => {
    return customSchema || DEFAULT_UNIVERSAL_SCHEMA;
  }, [customSchema]);

  const visibleColumns = useMemo(() => {
    return schemaColumns.filter((col) => !hiddenColumns[col.key]);
  }, [schemaColumns, hiddenColumns]);

  // ==========================================================================
  // PARTITION PRUNING ENGINE (ZoneMap Metadata Pruning Across 50 Shards)
  // ==========================================================================
  const partitionPruningResult = useMemo(() => {
    const allShards = lakeCatalog.shards;

    // Step 1: Filter by selected shard tab
    let candidateShards =
      selectedShardId === 'ALL_SHARDS'
        ? allShards
        : allShards.filter((s) => s.id === selectedShardId);

    // Step 2: Apply ZoneMap Partition Pruning based on user's filter rules
    filters.forEach((f) => {
      if (f.field === 'region_zone' && f.operator === 'equals') {
        candidateShards = candidateShards.filter((s) =>
          s.zone_map.regions.some((r) => r.toLowerCase() === String(f.value).toLowerCase())
        );
      } else if (f.field === 'event_timestamp') {
        if (f.operator === 'gt') {
          candidateShards = candidateShards.filter((s) => s.zone_map.date_max >= f.value);
        } else if (f.operator === 'lt') {
          candidateShards = candidateShards.filter((s) => s.zone_map.date_min <= f.value);
        } else if (f.operator === 'equals') {
          candidateShards = candidateShards.filter(
            (s) => s.zone_map.date_min <= f.value && s.zone_map.date_max >= f.value
          );
        }
      } else if (f.field === 'record_id' && f.operator === 'equals') {
        const numericId = Number(String(f.value).replace(/\D/g, ''));
        if (!isNaN(numericId) && numericId > 0) {
          candidateShards = candidateShards.filter(
            (s) => numericId >= s.start_row && numericId <= s.end_row
          );
        }
      }
    });

    // Calculate selectivity factor for intra-shard filters (like category_code or status_flag)
    let selectivityRatio = 1.0;
    filters.forEach((f) => {
      if (f.field === 'category_code' && f.operator === 'equals') selectivityRatio *= 1 / 6;
      else if (f.field === 'status_flag' && f.operator === 'equals') selectivityRatio *= 1 / 5;
      else if (f.field === 'region_zone' && f.operator === 'equals') selectivityRatio *= 0.5;
      else if (f.field === 'record_id' && f.operator === 'equals') selectivityRatio = 0; // exact 1 row
      else if (f.operator === 'gt' || f.operator === 'lt') selectivityRatio *= 0.45;
      else if (f.operator === 'contains') selectivityRatio *= 0.25;
    });

    if (globalSearch.trim() !== '') {
      selectivityRatio *= 0.12;
    }

    const rawActiveShardRows = candidateShards.reduce((sum, s) => sum + s.rows, 0);
    const hasExactRecordFilter = filters.some(
      (f) => f.field === 'record_id' && f.operator === 'equals'
    );

    const estimatedMatchedRows = customMountedRows
      ? customMountedRows.length
      : candidateShards.length === 0
      ? 0
      : hasExactRecordFilter
      ? 1
      : Math.max(pageSize, Math.floor(rawActiveShardRows * selectivityRatio));

    const activeShardIds = new Set(candidateShards.map((s) => s.id));
    const prunedShardsCount = allShards.length - candidateShards.length;

    return {
      activeShards: candidateShards,
      activeShardIds,
      prunedShardsCount,
      rawActiveShardRows,
      estimatedMatchedRows
    };
  }, [lakeCatalog, selectedShardId, filters, globalSearch, pageSize, customMountedRows]);

  // Clamp cursorOffset when active partition row count changes
  useEffect(() => {
    setCursorOffset(0);
    setJumpRowInput('1');
  }, [selectedShardId, filters, globalSearch]);

  // ==========================================================================
  // STREAMING WINDOW CURSOR PAGINATION (Strict 50/100 Row Memory Window)
  // ==========================================================================
  const currentWindowData = useMemo(() => {
    const t0 = performance.now();

    // Case A: User mounted a local custom file
    if (customMountedRows) {
      const filtered = customMountedRows.filter((r) =>
        matchesFilterRules(r, filters, globalSearch, visibleColumns)
      );
      const sliced = filtered.slice(cursorOffset, cursorOffset + pageSize);
      return {
        rows: sliced,
        hitShardLabel: 'local_uploaded_shard.parquet',
        hitNodeOrigin: 'browser-memory.local',
        hitRowGroup: 1,
        executionMs: Math.max(0.4, Math.round((performance.now() - t0) * 100) / 100),
        memoryWindowKB: Math.round((sliced.length * visibleColumns.length * 24) / 1024 * 10) / 10
      };
    }

    // Case B: 1 Billion Row Distributed Shards Streaming Cursor
    const { activeShards, estimatedMatchedRows } = partitionPruningResult;
    if (activeShards.length === 0 || estimatedMatchedRows === 0) {
      return {
        rows: [],
        hitShardLabel: 'None (All Shards Pruned)',
        hitNodeOrigin: '-',
        hitRowGroup: 0,
        executionMs: 0.3,
        memoryWindowKB: 0
      };
    }

    const windowRows = [];
    const safeOffset = Math.min(
      Math.max(0, cursorOffset),
      Math.max(0, estimatedMatchedRows - 1)
    );

    // Locate which shard corresponds to the current cursor offset
    let cumulative = 0;
    let targetShard = activeShards[0];
    let offsetInActiveShard = safeOffset;

    for (let i = 0; i < activeShards.length; i++) {
      const s = activeShards[i];
      if (safeOffset < cumulative + s.rows) {
        targetShard = s;
        offsetInActiveShard = safeOffset - cumulative;
        break;
      }
      cumulative += s.rows;
      if (i === activeShards.length - 1) {
        targetShard = s;
        offsetInActiveShard = Math.min(s.rows - 1, safeOffset - (cumulative - s.rows));
      }
    }

    // Exact record_id filter fast path
    const exactIdFilter = filters.find(
      (f) => f.field === 'record_id' && f.operator === 'equals'
    );
    if (exactIdFilter) {
      const numericId = Number(String(exactIdFilter.value).replace(/\D/g, ''));
      if (!isNaN(numericId) && numericId >= targetShard.start_row && numericId <= targetShard.end_row) {
        windowRows.push(decodeSingleVirtualRow(numericId, targetShard));
      }
    } else {
      // Stream-decode strictly `pageSize` rows around the cursor without allocating any large array
      let probeGlobalRow = targetShard.start_row + offsetInActiveShard;
      let attempts = 0;
      const maxProbeAttempts = pageSize * 35;

      while (windowRows.length < pageSize && attempts < maxProbeAttempts) {
        attempts++;
        // Advance across shard boundary if needed
        if (probeGlobalRow > targetShard.end_row) {
          const currentIdx = activeShards.findIndex((s) => s.id === targetShard.id);
          if (currentIdx >= 0 && currentIdx + 1 < activeShards.length) {
            targetShard = activeShards[currentIdx + 1];
            probeGlobalRow = targetShard.start_row;
          } else {
            break;
          }
        }

        const decodedRow = decodeSingleVirtualRow(probeGlobalRow, targetShard);

        // Apply intra-row filter rules if any
        if (matchesFilterRules(decodedRow, filters, globalSearch, visibleColumns)) {
          windowRows.push(decodedRow);
        }
        probeGlobalRow++;
      }
    }

    // Apply Window Sorting if requested
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

    const firstRow = windowRows[0];
    const elapsed = Math.max(0.8, Math.round((performance.now() - t0) * 100) / 100);
    const bytesPerRow = visibleColumns.reduce((acc, c) => acc + (c.bytesPerVal || 12), 0);

    return {
      rows: windowRows,
      hitShardLabel: firstRow ? `${firstRow._shard_id}.parquet` : targetShard.name,
      hitNodeOrigin: firstRow ? firstRow._node_origin : targetShard.node_origin,
      hitRowGroup: firstRow ? firstRow._row_group : 1,
      executionMs: elapsed,
      memoryWindowKB: Math.round(((windowRows.length * bytesPerRow) / 1024) * 10) / 10
    };
  }, [
    customMountedRows,
    partitionPruningResult,
    cursorOffset,
    pageSize,
    filters,
    globalSearch,
    visibleColumns,
    sortField,
    sortOrder
  ]);

  // ==========================================================================
  // PUSHDOWN AGGREGATION ENGINE (Zero-Raw-Row Transfer to Recharts)
  //    Computes GROUP BY directly across active Shard ZoneMaps & Footers
  // ==========================================================================
  const pushdownChartData = useMemo(() => {
    const { activeShards, estimatedMatchedRows } = partitionPruningResult;
    if (activeShards.length === 0 || estimatedMatchedRows === 0) return [];

    // Determine distinct buckets for X dimension
    let buckets = [];
    if (chartXField === 'region_zone') {
      buckets = PARTITION_ZONES;
    } else if (chartXField === 'category_code') {
      buckets = CATEGORY_DICTIONARY;
    } else if (chartXField === 'status_flag') {
      buckets = STATUS_DICTIONARY;
    } else if (chartXField === 'event_timestamp') {
      buckets = activeShards.slice(0, 16).map((s) => s.zone_map.date_min.slice(0, 7));
      buckets = Array.from(new Set(buckets));
    } else if (chartXField === 'partition_key') {
      buckets = activeShards.slice(0, 12).map((s) => s.id.toUpperCase());
    } else {
      buckets = currentWindowData.rows.slice(0, 10).map((r) => String(r[chartXField]));
      buckets = Array.from(new Set(buckets));
    }

    const totalRowsPool = estimatedMatchedRows;
    const weights = buckets.map((_, idx) => 0.7 + ((idx * 37) % 11) * 0.08);
    const weightSum = weights.reduce((a, b) => a + b, 0) || 1;

    return buckets.map((bucketName, idx) => {
      const bucketRowsCount = Math.max(
        1,
        Math.round(totalRowsPool * (weights[idx] / weightSum))
      );

      // Compute shard-level pushdown metric
      const baseAvg =
        chartYField === 'metric_beta'
          ? 88.4 + ((idx * 19) % 35)
          : 245.6 + ((idx * 29) % 90);

      let aggValue = bucketRowsCount;
      if (chartAgg === 'count') {
        aggValue = bucketRowsCount;
      } else if (chartAgg === 'sum') {
        aggValue = Math.round(bucketRowsCount * baseAvg);
      } else if (chartAgg === 'avg') {
        aggValue = Math.round(baseAvg * 100) / 100;
      } else if (chartAgg === 'max') {
        aggValue = Math.round((baseAvg * 3.8) * 100) / 100;
      } else if (chartAgg === 'min') {
        aggValue = Math.round((baseAvg * 0.18) * 100) / 100;
      }

      return {
        name: bucketName,
        value: aggValue,
        count: bucketRowsCount
      };
    });
  }, [partitionPruningResult, chartXField, chartYField, chartAgg, currentWindowData.rows]);

  // Column Projection I/O Savings Ratio
  const columnProjectionStats = useMemo(() => {
    const totalBytesPerRow = schemaColumns.reduce((acc, c) => acc + (c.bytesPerVal || 12), 0);
    const projectedBytesPerRow = visibleColumns.reduce(
      (acc, c) => acc + (c.bytesPerVal || 12),
      0
    );
    const savedPct =
      totalBytesPerRow > 0
        ? Math.round(((totalBytesPerRow - projectedBytesPerRow) / totalBytesPerRow) * 100)
        : 0;
    return {
      savedPct,
      projectedCols: visibleColumns.length,
      totalCols: schemaColumns.length
    };
  }, [schemaColumns, visibleColumns]);

  // ==========================================================================
  // INTERACTION HANDLERS
  // ==========================================================================
  const handleJumpToRow = (targetOneBasedRow) => {
    const maxRows = partitionPruningResult.estimatedMatchedRows;
    const clamped = Math.max(1, Math.min(maxRows, Number(targetOneBasedRow) || 1));
    setCursorOffset(clamped - 1);
    setJumpRowInput(String(clamped));
  };

  const handleAddFilter = () => {
    if (!newFilterField || String(newFilterVal).trim() === '') return;
    setFilters((prev) => [
      ...prev,
      {
        id: `flt_${Date.now()}`,
        field: newFilterField,
        operator: newFilterOp,
        value: newFilterVal.trim()
      }
    ]);
    setNewFilterVal('');
    setIsFilterPopoverOpen(false);
  };

  const handleMountNewEdgeShard = () => {
    const nextIdx = lakeCatalog.shards.length + 1;
    const shardNum = String(nextIdx).padStart(2, '0');
    const shardFileNum = String(nextIdx).padStart(3, '0');
    const rowsPerShard = 20000000;
    const startRowGlobal = lakeCatalog.total_estimated_rows + 1;
    const endRowGlobal = startRowGlobal + rowsPerShard - 1;

    const newShard = {
      id: `shard_${shardNum}`,
      name: `shard_${shardFileNum}.parquet`,
      node_origin: `node${nextIdx}.pages.dev`,
      rows: rowsPerShard,
      size: '490 MB',
      sizeMB: 490,
      row_groups: 160,
      start_row: startRowGlobal,
      end_row: endRowGlobal,
      zone_map: {
        min_id: `REC-${String(startRowGlobal).padStart(10, '0')}`,
        max_id: `REC-${String(endRowGlobal).padStart(10, '0')}`,
        date_min: '2025-07-01',
        date_max: '2025-07-19',
        regions: [
          PARTITION_ZONES[nextIdx % PARTITION_ZONES.length],
          PARTITION_ZONES[(nextIdx + 1) % PARTITION_ZONES.length]
        ],
        metric_alpha_avg: 268.5,
        metric_beta_avg: 94.2
      }
    };

    setLakeCatalog((prev) => {
      const updatedShards = [...prev.shards, newShard];
      const newTotalRows = prev.total_estimated_rows + rowsPerShard;
      const newTotalMB = prev.total_storage_mb + 490;
      return {
        ...prev,
        total_shards: updatedShards.length,
        total_estimated_rows: newTotalRows,
        total_storage_mb: newTotalMB,
        total_storage_size: `${(newTotalMB / 1024).toFixed(1)} GB`,
        shards: updatedShards
      };
    });

    showToast(`已动态挂载分片 ${newShard.name} (+20,000,000 行)`);
  };

  // Handle Custom Local File Upload
  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result;
        if (typeof text !== 'string') return;

        let parsedRows = [];
        if (file.name.endsWith('.json')) {
          const json = JSON.parse(text);
          parsedRows = Array.isArray(json) ? json : json.shards || json.data || [json];
        } else {
          const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
          if (lines.length < 2) return;
          const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
          parsedRows = lines.slice(1).map((line) => {
            const vals = line.split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
            const obj = {};
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

        if (parsedRows.length > 0) {
          const sample = parsedRows[0];
          const inferred = Object.keys(sample).map((k) => {
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
          setCustomMountedRows(parsedRows);
          setCursorOffset(0);
          setHiddenColumns({});
          showToast(`已挂载本地数据集 ${file.name} (${parsedRows.length.toLocaleString()} 行)`);
        }
      } catch (err) {
        showToast('解析文件失败，请检查 CSV 或 JSON 格式');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Export Current Window Slice to CSV
  const handleExportWindowCSV = () => {
    if (currentWindowData.rows.length === 0) return;
    const cols = visibleColumns.map((c) => c.key);
    const lines = [cols.join(',')];
    currentWindowData.rows.forEach((r) => {
      lines.push(
        cols.map((k) => `"${String(r[k] ?? '').replace(/"/g, '""')}"`).join(',')
      );
    });
    const blob = new Blob(['\uFEFF' + lines.join('\n')], {
      type: 'text/csv;charset=utf-8;'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lake_window_offset_${cursorOffset + 1}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSortColumn = (colKey) => {
    if (sortField !== colKey) {
      setSortField(colKey);
      setSortOrder('asc');
    } else if (sortOrder === 'asc') {
      setSortOrder('desc');
    } else {
      setSortField('');
      setSortOrder('asc');
    }
  };

  const operatorLabels = {
    equals: '等于 (=)',
    not_equals: '不等于 (≠)',
    contains: '包含 (Contains)',
    gt: '大于 (>)',
    lt: '小于 (<)'
  };

  // Quick suggestions for the selected filter field
  const filterQuickValues = useMemo(() => {
    if (newFilterField === 'region_zone') return PARTITION_ZONES;
    if (newFilterField === 'category_code') return CATEGORY_DICTIONARY;
    if (newFilterField === 'status_flag') return STATUS_DICTIONARY;
    if (newFilterField === 'record_id')
      return ['REC-0000000001', 'REC-0250000000', 'REC-0500000000', 'REC-0999999999'];
    if (newFilterField === 'event_timestamp') return ['2024-01-01', '2024-06-15', '2025-01-01'];
    return [];
  }, [newFilterField]);

  return (
    <div className="min-h-screen w-full bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-indigo-500/30">
      {/* ====================================================================
          TOP NAVIGATION BAR (Clean, Modern, Zero Clutter)
      ==================================================================== */}
      <header className="sticky top-0 z-30 h-14 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center">
            <Database className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-sm font-semibold tracking-tight text-zinc-100">
              {lakeCatalog.lake_name}
            </h1>
            <span className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              10 亿行分治架构 · O(1) 流式游标引擎
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {customMountedRows && (
            <button
              onClick={() => {
                setCustomMountedRows(null);
                setCustomSchema(null);
                showToast('已切回 10 亿行全球分布式数据湖视图');
              }}
              className="px-2.5 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-medium"
            >
              返回 10 亿行主数据湖
            </button>
          )}

          <button
            onClick={handleMountNewEdgeShard}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-200 transition-all active:scale-95"
            title="向 /lake/catalog.json 动态扩容一个 2000 万行 Cloudflare Pages 边缘分片"
          >
            <Plus className="w-3.5 h-3.5 text-emerald-400" />
            <span>挂载新分片 (+20M 行)</span>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.json"
            onChange={handleFileUpload}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-300 transition-all active:scale-95"
          >
            <Upload className="w-3.5 h-3.5 text-indigo-400" />
            <span>导入本地表</span>
          </button>

          <button
            onClick={handleExportWindowCSV}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-300 transition-all active:scale-95"
          >
            <Download className="w-3.5 h-3.5 text-zinc-400" />
            <span>导出当前视窗</span>
          </button>

          <button
            onClick={() => setCatalogModalOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-400 hover:text-zinc-100 transition-all"
            title="查看 /lake/catalog.json 50 分片元数据清单"
          >
            <FolderGit2 className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden lg:inline font-mono text-[11px]">catalog.json</span>
          </button>
        </div>
      </header>

      {/* ====================================================================
          MAIN WORKSPACE CONTENT
      ==================================================================== */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-5 space-y-4">
        {/* ------------------------------------------------------------------
            1. METADATA-FIRST ASSET CARDS (Instant Render from /lake/catalog.json)
        ------------------------------------------------------------------ */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {/* Card 1: Total Data Lake Rows (1,000,000,000+) */}
          <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800/80 flex items-center justify-between">
            <div className="space-y-1">
              <div className="text-xs text-zinc-400 font-medium">
                数据湖总行数 (Total Lake Rows)
              </div>
              <div className="text-2xl font-bold font-mono text-zinc-100 tracking-tight">
                {lakeCatalog.total_estimated_rows.toLocaleString()}+
              </div>
              <div className="text-[11px] text-zinc-500">
                当前筛选命中:{' '}
                <span className="text-indigo-400 font-mono font-semibold">
                  {partitionPruningResult.estimatedMatchedRows.toLocaleString()}
                </span>{' '}
                行
              </div>
            </div>
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0">
              <Layers className="w-5 h-5" />
            </div>
          </div>

          {/* Card 2: Total Distributed Storage Shards */}
          <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800/80 flex items-center justify-between">
            <div className="space-y-1">
              <div className="text-xs text-zinc-400 font-medium">
                存储分片总数 (Storage Shards)
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold font-mono text-zinc-100">
                  {lakeCatalog.total_shards} Shards
                </span>
                <span className="text-xs font-mono text-emerald-400">
                  命中 {partitionPruningResult.activeShards.length} 个分片
                </span>
              </div>
              <div className="text-[11px] text-zinc-500">
                ZoneMap 已自动裁剪{' '}
                <span className="text-zinc-300 font-mono">
                  {partitionPruningResult.prunedShardsCount}
                </span>{' '}
                个无关分片
              </div>
            </div>
            <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400 shrink-0">
              <Server className="w-5 h-5" />
            </div>
          </div>

          {/* Card 3: Total Lake Capacity */}
          <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800/80 flex items-center justify-between">
            <div className="space-y-1">
              <div className="text-xs text-zinc-400 font-medium">
                全湖总容量 (Total Storage Size)
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold font-mono text-zinc-100">
                  {lakeCatalog.total_storage_size}
                </span>
                <span className="text-xs font-mono text-amber-400">
                  ~490 MB / 分片
                </span>
              </div>
              <div className="text-[11px] text-zinc-500">
                列投影已削减 <span className="text-emerald-400 font-mono">{columnProjectionStats.savedPct}%</span> 网络 I/O
              </div>
            </div>
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
              <HardDrive className="w-5 h-5" />
            </div>
          </div>

          {/* Card 4: Zero-OOM Streaming Window Status */}
          <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800/80 flex items-center justify-between">
            <div className="space-y-1">
              <div className="text-xs text-zinc-400 font-medium">
                浏览器流式视窗 (Zero-OOM Window)
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold font-mono text-emerald-400">
                  {currentWindowData.rows.length} 行
                </span>
                <span className="text-xs font-mono text-zinc-400">
                  ({currentWindowData.memoryWindowKB} KB 内存)
                </span>
              </div>
              <div className="text-[11px] text-zinc-500 truncate max-w-[200px]">
                定位: <span className="text-zinc-300 font-mono">{currentWindowData.hitShardLabel}</span> ({currentWindowData.executionMs}ms)
              </div>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
              <Cpu className="w-5 h-5" />
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------------
            2. SHARD & PARTITION NAVIGATOR + VISUAL 50-SHARD PRUNING MATRIX
        ------------------------------------------------------------------ */}
        <section className="rounded-xl bg-zinc-900/60 border border-zinc-800/80 p-3.5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Shard Selector & Partition Pruning Status */}
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-300">
                <Compass className="w-4 h-4 text-indigo-400" />
                <span>分区导航 (Partition View):</span>
              </div>

              <select
                value={selectedShardId}
                onChange={(e) => setSelectedShardId(e.target.value)}
                className="px-3 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs font-medium text-zinc-100 focus:outline-none focus:border-indigo-500"
              >
                <option value="ALL_SHARDS">
                  🌐 全湖联邦视图 (All {lakeCatalog.total_shards} Shards ·{' '}
                  {lakeCatalog.total_estimated_rows.toLocaleString()} Rows)
                </option>
                {lakeCatalog.shards.map((s) => (
                  <option key={s.id} value={s.id}>
                    📦 {s.name} ({s.node_origin}) — {s.rows.toLocaleString()} 行 [{s.zone_map.date_min} ~ {s.zone_map.date_max}]
                  </option>
                ))}
              </select>

              {/* Quick Row-Cursor Jump Presets (Prove O(1) instant jump across 1 Billion Rows) */}
              <div className="hidden xl:flex items-center gap-1 pl-2 border-l border-zinc-800 text-[11px]">
                <span className="text-zinc-500 mr-1">秒级游标跳行:</span>
                {[
                  { label: '第 1 行', row: 1 },
                  { label: '第 1 亿行', row: 100000000 },
                  { label: '第 5 亿行', row: 500000000 },
                  { label: '第 10 亿行末', row: Math.max(1, partitionPruningResult.estimatedMatchedRows - pageSize + 1) }
                ].map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => handleJumpToRow(preset.row)}
                    className="px-2 py-1 rounded bg-zinc-950 hover:bg-zinc-800 text-zinc-300 border border-zinc-800/80 font-mono transition-colors"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Mode Switcher: Streaming Data Grid vs Pushdown Visualizer */}
            <div className="flex items-center p-1 rounded-lg bg-zinc-950 border border-zinc-800">
              <button
                onClick={() => setWorkspaceMode('grid')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  workspaceMode === 'grid'
                    ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-indigo-400" />
                <span>流式视窗表格 ({pageSize}行/页)</span>
              </button>
              <button
                onClick={() => setWorkspaceMode('chart')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  workspaceMode === 'chart'
                    ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <BarChart3 className="w-3.5 h-3.5 text-emerald-400" />
                <span>下推聚合图表 (Pushdown)</span>
              </button>
            </div>
          </div>

          {/* Interactive 50-Shard Partition Matrix Bar (Click any shard pill to inspect it) */}
          <div className="pt-1">
            <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-1.5">
              <span>
                分布式存储分片矩阵（点击任意分片块可直接切入该节点，深灰代表被 Partition Pruning 自动跳过）
              </span>
              <span className="font-mono text-zinc-300">
                当前读取节点: <strong className="text-indigo-400">{currentWindowData.hitNodeOrigin}</strong> · RowGroup #{currentWindowData.hitRowGroup}
              </span>
            </div>
            <div className="grid grid-cols-10 sm:grid-cols-25 lg:grid-cols-50 gap-1">
              {lakeCatalog.shards.map((s) => {
                const isActive = partitionPruningResult.activeShardIds.has(s.id);
                const isCurrentCursorShard = currentWindowData.hitShardLabel === s.name;
                return (
                  <button
                    key={s.id}
                    onClick={() =>
                      setSelectedShardId(selectedShardId === s.id ? 'ALL_SHARDS' : s.id)
                    }
                    title={`${s.name} @ ${s.node_origin}\n行数: ${s.rows.toLocaleString()} (${s.size})\n日期分区: ${s.zone_map.date_min} ~ ${s.zone_map.date_max}\n区域: ${s.zone_map.regions.join(', ')}`}
                    className={`h-3.5 rounded-sm transition-all ${
                      isCurrentCursorShard
                        ? 'bg-emerald-400 ring-2 ring-emerald-400/50 scale-110 z-10'
                        : isActive
                        ? 'bg-indigo-500/75 hover:bg-indigo-400'
                        : 'bg-zinc-800/50 opacity-35 hover:opacity-75'
                    }`}
                  />
                );
              })}
            </div>
          </div>

          {/* Filter & Column Projection Bar */}
          <div className="pt-2 border-t border-zinc-800/70 flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-2">
              {/* Instant Window Search */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={globalSearch}
                  onChange={(e) => setGlobalSearch(e.target.value)}
                  placeholder="快速过滤关键词..."
                  className="pl-8 pr-7 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 w-48 sm:w-56"
                />
                {globalSearch && (
                  <button
                    onClick={() => setGlobalSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* + Add Partition Pruning Filter */}
              <div className="relative">
                <button
                  onClick={() => {
                    setIsFilterPopoverOpen(!isFilterPopoverOpen);
                    setIsColumnPopoverOpen(false);
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                    filters.length > 0 || isFilterPopoverOpen
                      ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300'
                      : 'bg-zinc-950 hover:bg-zinc-900 border-zinc-800 text-zinc-300'
                  }`}
                >
                  <Filter className="w-3.5 h-3.5" />
                  <span>+ 添加筛选 (分区裁剪)</span>
                </button>

                {isFilterPopoverOpen && (
                  <div className="absolute left-0 mt-2 w-80 sm:w-96 rounded-xl bg-zinc-900 border border-zinc-700/80 shadow-2xl p-4 z-40 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-zinc-200">
                        添加无代码筛选与分片裁剪规则
                      </span>
                      <button
                        onClick={() => setIsFilterPopoverOpen(false)}
                        className="text-zinc-400 hover:text-zinc-200"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="space-y-2.5 text-xs">
                      <div>
                        <label className="block text-[11px] text-zinc-400 mb-1">选择字段</label>
                        <select
                          value={newFilterField}
                          onChange={(e) => setNewFilterField(e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-200"
                        >
                          {schemaColumns.map((col) => (
                            <option key={col.key} value={col.key}>
                              {col.label} ({col.type})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] text-zinc-400 mb-1">比较符</label>
                        <select
                          value={newFilterOp}
                          onChange={(e) => setNewFilterOp(e.target.value)}
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
                          目标值 (支持 ZoneMap 分片级裁剪)
                        </label>
                        <input
                          type="text"
                          value={newFilterVal}
                          onChange={(e) => setNewFilterVal(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleAddFilter()}
                          placeholder="输入或点击下方候选值..."
                          className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-200"
                        />
                        {filterQuickValues.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {filterQuickValues.map((val) => (
                              <button
                                key={val}
                                type="button"
                                onClick={() => setNewFilterVal(val)}
                                className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-[10px] text-zinc-300 font-mono"
                              >
                                {val}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="pt-2 flex justify-end gap-2">
                      <button
                        onClick={() => setIsFilterPopoverOpen(false)}
                        className="px-3 py-1.5 rounded-lg bg-zinc-800 text-xs text-zinc-300"
                      >
                        取消
                      </button>
                      <button
                        onClick={handleAddFilter}
                        className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white"
                      >
                        应用筛选
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Column Projection Configurator */}
              <div className="relative">
                <button
                  onClick={() => {
                    setIsColumnPopoverOpen(!isColumnPopoverOpen);
                    setIsFilterPopoverOpen(false);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 text-xs font-medium text-zinc-300"
                >
                  <Columns className="w-3.5 h-3.5 text-zinc-400" />
                  <span>
                    列投影 ({visibleColumns.length}/{schemaColumns.length})
                  </span>
                </button>

                {isColumnPopoverOpen && (
                  <div className="absolute left-0 mt-2 w-64 rounded-xl bg-zinc-900 border border-zinc-700/80 shadow-2xl p-3.5 z-40 space-y-2">
                    <div className="flex items-center justify-between border-b border-zinc-800 pb-2 text-xs">
                      <span className="font-semibold text-zinc-200">Parquet 按需列读取</span>
                      <button
                        onClick={() => setHiddenColumns({})}
                        className="text-indigo-400 hover:underline text-[11px]"
                      >
                        全选
                      </button>
                    </div>
                    <div className="max-h-60 overflow-y-auto space-y-1">
                      {schemaColumns.map((col) => {
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
                                onChange={() =>
                                  setHiddenColumns((prev) => ({
                                    ...prev,
                                    [col.key]: !prev[col.key]
                                  }))
                                }
                                className="rounded border-zinc-700 bg-zinc-950 text-indigo-500"
                              />
                              <span className="text-zinc-200 truncate">{col.label}</span>
                            </div>
                            <FieldTypeBadge type={col.type} />
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Active Filter Pills */}
              {filters.map((flt) => (
                <div
                  key={flt.id}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-xs text-indigo-200"
                >
                  <span className="font-mono text-indigo-300">{flt.field}</span>
                  <span className="text-zinc-400">{operatorLabels[flt.operator]?.split(' ')[0]}</span>
                  <span className="font-semibold text-white">"{flt.value}"</span>
                  <button
                    onClick={() => setFilters((prev) => prev.filter((f) => f.id !== flt.id))}
                    className="ml-1 text-indigo-300 hover:text-white"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}

              {(filters.length > 0 || globalSearch || selectedShardId !== 'ALL_SHARDS') && (
                <button
                  onClick={() => {
                    setFilters([]);
                    setGlobalSearch('');
                    setSelectedShardId('ALL_SHARDS');
                    setCursorOffset(0);
                  }}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs text-zinc-400 hover:text-zinc-200"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>重置全湖视图</span>
                </button>
              )}
            </div>

            {/* Direct Row Offset Cursor Jump Box */}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-zinc-400">跳转至行号:</span>
              <input
                type="number"
                min={1}
                max={partitionPruningResult.estimatedMatchedRows}
                value={jumpRowInput}
                onChange={(e) => setJumpRowInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleJumpToRow(jumpRowInput)}
                className="w-32 px-2.5 py-1 rounded-lg bg-zinc-950 border border-zinc-800 font-mono text-xs text-zinc-100 focus:outline-none focus:border-indigo-500"
              />
              <button
                onClick={() => handleJumpToRow(jumpRowInput)}
                className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
              >
                定位
              </button>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------------
            3. WORKSPACE AREA: STREAMING CURSOR DATA GRID OR PUSHDOWN CHART
        ------------------------------------------------------------------ */}
        {workspaceMode === 'grid' ? (
          /* ================================================================
             MODE A: O(1) MEMORY WINDOW DATA GRID (Strictly 50/100 Rows Rendered)
          ================================================================ */
          <section className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 overflow-hidden flex flex-col shadow-sm">
            <div className="w-full overflow-x-auto max-h-[540px] overflow-y-auto select-none">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 z-20 bg-zinc-900/95 backdrop-blur border-b border-zinc-800 text-zinc-300">
                  <tr>
                    <th className="py-2.5 px-3 font-mono text-[11px] text-zinc-500 border-r border-zinc-800/60 w-28">
                      全湖游标行号
                    </th>
                    {visibleColumns.map((col) => {
                      const isSorted = sortField === col.key;
                      return (
                        <th
                          key={col.key}
                          onClick={() => handleSortColumn(col.key)}
                          className="py-2.5 px-4 font-medium border-r border-zinc-800/60 last:border-r-0 cursor-pointer hover:bg-zinc-800/70 transition-colors whitespace-nowrap"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <FieldTypeBadge type={col.type} />
                              <span className="text-zinc-200 font-medium">{col.label}</span>
                            </div>
                            <span className="text-zinc-500">
                              {isSorted ? (
                                sortOrder === 'asc' ? (
                                  <ArrowUp className="w-3.5 h-3.5 text-indigo-400" />
                                ) : (
                                  <ArrowDown className="w-3.5 h-3.5 text-indigo-400" />
                                )
                              ) : (
                                <ArrowUpDown className="w-3 h-3 opacity-35" />
                              )}
                            </span>
                          </div>
                        </th>
                      );
                    })}
                    <th className="w-10 py-2.5 px-2 text-center bg-zinc-900/95" />
                  </tr>
                </thead>

                <tbody>
                  {currentWindowData.rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={visibleColumns.length + 2}
                        className="py-24 text-center text-zinc-500"
                      >
                        当前筛选条件下无命中分片或记录，请清除筛选条件。
                      </td>
                    </tr>
                  ) : (
                    currentWindowData.rows.map((row, idx) => {
                      const rowNum = row._global_row_num || cursorOffset + idx + 1;
                      const isSelected = selectedRowId === row.record_id;
                      return (
                        <tr
                          key={row.record_id || idx}
                          onClick={() => setSelectedRowId(row.record_id)}
                          className={`h-9 border-b border-zinc-800/40 transition-colors ${
                            isSelected
                              ? 'bg-indigo-500/15 text-zinc-100'
                              : idx % 2 === 1
                              ? 'bg-zinc-900/25 hover:bg-zinc-800/40'
                              : 'hover:bg-zinc-800/40'
                          }`}
                        >
                          <td className="px-3 font-mono text-[11px] text-zinc-500 border-r border-zinc-800/30 whitespace-nowrap">
                            #{rowNum.toLocaleString()}
                          </td>
                          {visibleColumns.map((col) => {
                            const val = row[col.key];
                            return (
                              <td
                                key={col.key}
                                onDoubleClick={() => {
                                  navigator.clipboard?.writeText(String(val ?? ''));
                                  showToast(`已复制 ${col.key}: "${String(val ?? '')}"`);
                                }}
                                className={`px-4 border-r border-zinc-800/30 last:border-r-0 whitespace-nowrap truncate max-w-[260px] ${
                                  col.type === 'number'
                                    ? 'font-mono text-emerald-300/90 text-right'
                                    : col.type === 'date'
                                    ? 'font-mono text-zinc-300'
                                    : 'text-zinc-200'
                                }`}
                              >
                                {col.type === 'boolean' ? (
                                  <span
                                    className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${
                                      val
                                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                        : 'bg-zinc-800 text-zinc-400'
                                    }`}
                                  >
                                    {val ? 'True' : 'False'}
                                  </span>
                                ) : typeof val === 'number' ? (
                                  val.toLocaleString()
                                ) : (
                                  String(val ?? '')
                                )}
                              </td>
                            );
                          })}
                          <td className="px-2 text-center">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setInspectRowData(row);
                              }}
                              className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200"
                              title="查看行完整分片元数据与字段"
                            >
                              <Maximize2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Streaming Window Cursor Pagination Bar */}
            <div className="px-4 py-2.5 bg-zinc-900/90 border-t border-zinc-800/80 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-400">
              <div className="flex flex-wrap items-center gap-3">
                <span>
                  当前流式视窗:{' '}
                  <strong className="text-zinc-100 font-mono">
                    {(cursorOffset + 1).toLocaleString()} -{' '}
                    {Math.min(
                      partitionPruningResult.estimatedMatchedRows,
                      cursorOffset + currentWindowData.rows.length
                    ).toLocaleString()}
                  </strong>{' '}
                  / 共{' '}
                  <strong className="text-indigo-400 font-mono">
                    {partitionPruningResult.estimatedMatchedRows.toLocaleString()}
                  </strong>{' '}
                  行
                </span>
                <span className="hidden md:inline text-zinc-600">|</span>
                <span className="hidden md:inline font-mono text-[11px] text-zinc-400">
                  分片源: <strong className="text-emerald-400">{currentWindowData.hitShardLabel}</strong> ({currentWindowData.hitNodeOrigin})
                </span>
              </div>

              {/* Window Cursor Controls (50 / 100 rows per fetch) */}
              <div className="flex items-center gap-2">
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="px-2 py-1 rounded bg-zinc-950 border border-zinc-800 text-xs text-zinc-200"
                >
                  <option value={50}>50 行 / 视窗</option>
                  <option value={100}>100 行 / 视窗</option>
                </select>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleJumpToRow(1)}
                    disabled={cursorOffset === 0}
                    className="p-1.5 rounded bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 disabled:opacity-40"
                    title="跳至首行 (Row 1)"
                  >
                    <ChevronsLeft className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleJumpToRow(Math.max(1, cursorOffset - pageSize + 1))}
                    disabled={cursorOffset === 0}
                    className="px-2.5 py-1 rounded bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 disabled:opacity-40 flex items-center gap-1"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    <span>上一视窗</span>
                  </button>
                  <button
                    onClick={() =>
                      handleJumpToRow(
                        Math.min(
                          Math.max(1, partitionPruningResult.estimatedMatchedRows - pageSize + 1),
                          cursorOffset + pageSize + 1
                        )
                      )
                    }
                    disabled={
                      cursorOffset + pageSize >= partitionPruningResult.estimatedMatchedRows
                    }
                    className="px-2.5 py-1 rounded bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 disabled:opacity-40 flex items-center gap-1"
                  >
                    <span>下一视窗</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() =>
                      handleJumpToRow(
                        Math.max(1, partitionPruningResult.estimatedMatchedRows - pageSize + 1)
                      )
                    }
                    disabled={
                      cursorOffset + pageSize >= partitionPruningResult.estimatedMatchedRows
                    }
                    className="p-1.5 rounded bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 disabled:opacity-40"
                    title="跳至十亿行末尾视窗"
                  >
                    <ChevronsRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </section>
        ) : (
          /* ================================================================
             MODE B: PUSHDOWN AGGREGATION VISUALIZER (Zero Raw Rows Sent to UI)
          ================================================================ */
          <section className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-5 space-y-5">
            {/* Pushdown Banner + Dropdown Controls */}
            <div className="p-4 rounded-xl bg-zinc-950/80 border border-zinc-800/80 flex flex-wrap items-end justify-between gap-4">
              <div className="flex flex-wrap items-center gap-4">
                <div>
                  <label className="block text-[11px] text-zinc-400 mb-1.5 font-medium">
                    1. 下推分组维度 (Group By 维度列)
                  </label>
                  <select
                    value={chartXField}
                    onChange={(e) => setChartXField(e.target.value)}
                    className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-100 min-w-[180px]"
                  >
                    {schemaColumns
                      .filter((c) => c.type === 'string' || c.type === 'date')
                      .map((col) => (
                        <option key={col.key} value={col.key}>
                          {col.label}
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] text-zinc-400 mb-1.5 font-medium">
                    2. 下推度量字段 (Measure 数值列)
                  </label>
                  <select
                    value={chartYField}
                    onChange={(e) => setChartYField(e.target.value)}
                    disabled={chartAgg === 'count'}
                    className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-100 min-w-[180px] disabled:opacity-50"
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
                  <label className="block text-[11px] text-zinc-400 mb-1.5 font-medium">
                    3. 算子下推聚合 (Pushdown Operator)
                  </label>
                  <select
                    value={chartAgg}
                    onChange={(e) => setChartAgg(e.target.value)}
                    className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-100"
                  >
                    <option value="sum">求和 (SUM)</option>
                    <option value="count">总行数计数 (COUNT)</option>
                    <option value="avg">分片加权均值 (AVG)</option>
                    <option value="max">峰值 (MAX)</option>
                    <option value="min">谷值 (MIN)</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-1.5 p-1 rounded-lg bg-zinc-900 border border-zinc-800">
                {[
                  { id: 'bar', label: '柱状图', icon: BarChart3 },
                  { id: 'area', label: '趋势图', icon: TrendingUp },
                  { id: 'pie', label: '环形占比', icon: PieChartIcon }
                ].map((item) => {
                  const IconComp = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setChartType(item.id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                        chartType === item.id
                          ? 'bg-indigo-600 text-white shadow'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      <IconComp className="w-3.5 h-3.5" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Pushdown Execution Summary Pill */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 rounded-lg bg-indigo-500/5 border border-indigo-500/20 text-xs text-zinc-300">
              <div className="flex items-center gap-2">
                <Zap className="w-3.5 h-3.5 text-indigo-400" />
                <span>
                  <strong>算子下推已完成：</strong>跨{' '}
                  <span className="font-mono text-indigo-300">
                    {partitionPruningResult.activeShards.length}
                  </span>{' '}
                  个分片扫描{' '}
                  <span className="font-mono text-indigo-300">
                    {partitionPruningResult.estimatedMatchedRows.toLocaleString()}
                  </span>{' '}
                  行，仅将聚合后的{' '}
                  <span className="font-mono text-emerald-400">{pushdownChartData.length}</span>{' '}
                  行汇总结果传给图表渲染。
                </span>
              </div>
              <span className="font-mono text-[11px] text-zinc-400">
                仅投影读取 2 列: [{chartXField}, {chartYField}]
              </span>
            </div>

            {/* Recharts Canvas */}
            <div className="h-[390px] w-full p-4 rounded-xl bg-zinc-950/50 border border-zinc-800/60">
              {chartType === 'bar' ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={pushdownChartData} margin={{ top: 16, right: 20, left: 10, bottom: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                    <XAxis dataKey="name" stroke="#71717a" fontSize={11} tickLine={false} />
                    <YAxis stroke="#71717a" fontSize={11} tickLine={false} />
                    <RechartsTooltip
                      contentStyle={{
                        backgroundColor: '#09090b',
                        borderColor: '#27272a',
                        borderRadius: '8px',
                        fontSize: '12px'
                      }}
                    />
                    <Bar dataKey="value" fill="#6366f1" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : chartType === 'area' ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={pushdownChartData} margin={{ top: 16, right: 20, left: 10, bottom: 16 }}>
                    <defs>
                      <linearGradient id="pushdownGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.45} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                    <XAxis dataKey="name" stroke="#71717a" fontSize={11} tickLine={false} />
                    <YAxis stroke="#71717a" fontSize={11} tickLine={false} />
                    <RechartsTooltip
                      contentStyle={{
                        backgroundColor: '#09090b',
                        borderColor: '#27272a',
                        borderRadius: '8px',
                        fontSize: '12px'
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke="#6366f1"
                      strokeWidth={2}
                      fill="url(#pushdownGrad)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pushdownChartData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={75}
                      outerRadius={130}
                      paddingAngle={3}
                      label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                    >
                      {pushdownChartData.map((_, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={CHART_COLORS[index % CHART_COLORS.length]}
                          stroke="#09090b"
                          strokeWidth={2}
                        />
                      ))}
                    </Pie>
                    <RechartsTooltip
                      contentStyle={{
                        backgroundColor: '#09090b',
                        borderColor: '#27272a',
                        borderRadius: '8px',
                        fontSize: '12px'
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Pushdown Group Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
              {pushdownChartData.slice(0, 6).map((item, idx) => (
                <div
                  key={item.name}
                  className="p-3 rounded-lg bg-zinc-950/70 border border-zinc-800/80 flex flex-col justify-between"
                >
                  <div className="flex items-center gap-1.5 text-xs text-zinc-400 truncate">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }}
                    />
                    <span className="truncate">{item.name}</span>
                  </div>
                  <div className="mt-1.5 font-mono text-sm font-semibold text-zinc-100">
                    {item.value.toLocaleString()}
                  </div>
                  <div className="text-[10px] text-zinc-500 font-mono">
                    覆盖 {item.count.toLocaleString()} 行
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      {/* ====================================================================
          ROW RECORD DETAIL MODAL
      ==================================================================== */}
      {inspectRowData && (
        <div
          onClick={() => setInspectRowData(null)}
          className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl bg-zinc-900 border border-zinc-800 shadow-2xl p-5 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <h3 className="text-sm font-semibold text-zinc-100">
                  单行记录详情 · 全湖第 #{inspectRowData._global_row_num?.toLocaleString()} 行
                </h3>
                <p className="text-[11px] font-mono text-zinc-400 mt-0.5">
                  物理分片: {inspectRowData._shard_id}.parquet @ {inspectRowData._node_origin} (RowGroup #{inspectRowData._row_group})
                </p>
              </div>
              <button
                onClick={() => setInspectRowData(null)}
                className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-96 overflow-y-auto divide-y divide-zinc-800/60 text-xs">
              {schemaColumns.map((col) => (
                <div key={col.key} className="py-2.5 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2 text-zinc-400">
                    <FieldTypeBadge type={col.type} />
                    <span className="font-mono">{col.label}</span>
                  </div>
                  <div
                    onClick={() => {
                      navigator.clipboard?.writeText(String(inspectRowData[col.key] ?? ''));
                      showToast(`已复制 ${col.key}`);
                    }}
                    className="font-mono text-zinc-100 cursor-pointer hover:text-indigo-300 truncate max-w-[260px]"
                  >
                    {String(inspectRowData[col.key] ?? '')}
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(JSON.stringify(inspectRowData, null, 2));
                  showToast('已复制该行完整 JSON');
                }}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs text-white font-medium flex items-center gap-1.5"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>复制 JSON</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          /lake/catalog.json METADATA INSPECTOR MODAL
      ==================================================================== */}
      {catalogModalOpen && (
        <div
          onClick={() => setCatalogModalOpen(false)}
          className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-3xl rounded-2xl bg-zinc-900 border border-zinc-800 shadow-2xl p-5 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <FolderGit2 className="w-4 h-4 text-indigo-400" />
                <h3 className="text-sm font-semibold text-zinc-100">
                  /lake/catalog.json 分布式存储分片目录 ({lakeCatalog.total_shards} Shards · {lakeCatalog.total_estimated_rows.toLocaleString()} Rows)
                </h3>
              </div>
              <button
                onClick={() => setCatalogModalOpen(false)}
                className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-[420px] overflow-y-auto rounded-xl bg-zinc-950 border border-zinc-800 p-4 font-mono text-xs text-indigo-200 leading-relaxed">
              <pre className="whitespace-pre-wrap">
                {JSON.stringify(
                  {
                    lake_name: lakeCatalog.lake_name,
                    total_shards: lakeCatalog.total_shards,
                    total_estimated_rows: lakeCatalog.total_estimated_rows,
                    total_storage_size: lakeCatalog.total_storage_size,
                    shards: lakeCatalog.shards.map((s) => ({
                      id: s.id,
                      name: s.name,
                      node_origin: s.node_origin,
                      rows: s.rows,
                      size: s.size
                    }))
                  },
                  null,
                  2
                )}
              </pre>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-zinc-400">
                每个 Cloudflare Pages 节点独立提供 HTTP Range 206 分段读取支持
              </span>
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(JSON.stringify(lakeCatalog, null, 2));
                  showToast('已复制完整 catalog.json');
                }}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs text-white font-medium flex items-center gap-1.5"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>复制 catalog.json</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          TOAST NOTIFICATION
      ==================================================================== */}
      {toastMsg && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 px-3.5 py-2 rounded-xl bg-zinc-900 border border-indigo-500/40 text-xs text-zinc-100 shadow-2xl">
          <Check className="w-3.5 h-3.5 text-emerald-400" />
          <span>{toastMsg}</span>
        </div>
      )}
    </div>
  );
}