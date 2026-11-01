/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { StorageShard, LakeClusterCatalog, ShardZoneMap } from '../types/datalake.ts';

export const PARTITION_REGIONS = [
  'Zone-North',
  'Zone-South',
  'Zone-East',
  'Zone-West',
  'Zone-Central',
  'Zone-APAC',
  'Zone-EMEA'
];

export const CATEGORY_DICTIONARY = [
  'Finance',
  'Telemetry',
  'IoT-Sensor',
  'Logistics',
  'Security',
  'Analytics',
  'E-Commerce'
];

export const STATUS_DICTIONARY = ['Verified', 'Synced', 'Active', 'Archived', 'Pending'];

export const BATCH_IDS = [
  'BATCH-2024-Q1',
  'BATCH-2024-Q2',
  'BATCH-2024-Q3',
  'BATCH-2024-Q4',
  'BATCH-2025-Q1',
  'BATCH-2025-Q2',
  'BATCH-2025-Q3',
  'BATCH-2025-Q4',
  'BATCH-2026-Q1',
  'BATCH-2026-Q2'
];

export const DEFAULT_UNIVERSAL_SCHEMA = [
  { key: 'record_id', label: 'record_id', type: 'string', bytesPerVal: 16 },
  { key: 'partition_key', label: 'partition_key', type: 'string', bytesPerVal: 14 },
  { key: 'event_timestamp', label: 'event_timestamp', type: 'date', bytesPerVal: 10 },
  { key: 'region_zone', label: 'region_zone', type: 'string', bytesPerVal: 12 },
  { key: 'category_code', label: 'category_code', type: 'string', bytesPerVal: 12 },
  { key: 'status_flag', label: 'status_flag', type: 'string', bytesPerVal: 10 },
  { key: 'metric_alpha', label: 'metric_alpha', type: 'number', bytesPerVal: 8 },
  { key: 'metric_beta', label: 'metric_beta', type: 'number', bytesPerVal: 8 },
  { key: 'is_verified', label: 'is_verified', type: 'boolean', bytesPerVal: 1 },
  { key: 'payload_hash', label: 'payload_hash', type: 'string', bytesPerVal: 16 }
] as const;

/**
 * Re-indexes all shards sequentially so start_row and end_row form a continuous,
 * gap-free address space [1 .. TotalRows].
 * Capacity is completely decoupled from any hardcoded limits.
 */
export function reindexShards(rawShards: Omit<StorageShard, 'start_row' | 'end_row'>[]): StorageShard[] {
  let currentStart = 1;
  return rawShards.map((s, idx) => {
    const rows = Math.max(1, Math.round(Number(s.rows) || 50_000_000));
    const startRow = currentStart;
    const endRow = startRow + rows - 1;
    currentStart = endRow + 1;

    // Pad ID string nicely if necessary
    const paddedId = s.id || `shard_${String(idx + 1).padStart(4, '0')}`;
    const shardName = s.name || `${paddedId}.parquet`;
    const nodeOrigin = s.node_origin || `https://edge-node-${String(idx + 1).padStart(3, '0')}.lake.pages.dev`;

    return {
      ...s,
      id: paddedId,
      name: shardName,
      node_origin: nodeOrigin,
      rows,
      sizeMB: s.sizeMB || Math.round(rows * 0.0000098),
      row_groups: s.row_groups || Math.max(1, Math.floor(rows / 250_000)),
      start_row: startRow,
      end_row: endRow,
      zone_map: {
        ...s.zone_map,
        min_id: s.zone_map?.min_id || `REC-${String(startRow).padStart(12, '0')}`,
        max_id: s.zone_map?.max_id || `REC-${String(endRow).padStart(12, '0')}`,
        date_min: s.zone_map?.date_min || '2024-01-01',
        date_max: s.zone_map?.date_max || '2026-10-31',
        year_partitions: s.zone_map?.year_partitions || ['2024', '2025', '2026'],
        regions: s.zone_map?.regions?.length ? s.zone_map.regions : [PARTITION_REGIONS[idx % PARTITION_REGIONS.length]],
        categories: s.zone_map?.categories?.length ? s.zone_map.categories : [CATEGORY_DICTIONARY[idx % CATEGORY_DICTIONARY.length]],
        batch_id: s.zone_map?.batch_id || BATCH_IDS[idx % BATCH_IDS.length],
        metric_alpha_avg: s.zone_map?.metric_alpha_avg || Math.round((240 + Math.sin(idx * 0.4) * 85) * 100) / 100,
        metric_beta_avg: s.zone_map?.metric_beta_avg || Math.round((85 + Math.cos(idx * 0.3) * 32) * 100) / 100
      }
    };
  });
}

/**
 * Builds the default 10-Billion Row initial cluster
 * 200 shards × 50,000,000 rows = 10,000,000,000 rows
 */
export function buildInitialCluster(shardCount = 200, rowsPerShard = 50_000_000): LakeClusterCatalog {
  const shards: Omit<StorageShard, 'start_row' | 'end_row'>[] = [];
  const baseEpoch = new Date('2024-01-01T00:00:00Z').getTime();
  const stepMs = 5 * 86400 * 1000; // 5 days span per shard

  for (let i = 1; i <= shardCount; i++) {
    const shardNum = String(i).padStart(4, '0');
    const sizeMB = 475 + ((i * 13) % 45); // 475 ~ 520 MB

    const primaryRegion = PARTITION_REGIONS[(i - 1) % PARTITION_REGIONS.length];
    const secondaryRegion = PARTITION_REGIONS[(i + 1) % PARTITION_REGIONS.length];
    const category1 = CATEGORY_DICTIONARY[(i - 1) % CATEGORY_DICTIONARY.length];
    const category2 = CATEGORY_DICTIONARY[i % CATEGORY_DICTIONARY.length];
    const batchId = BATCH_IDS[(i - 1) % BATCH_IDS.length];

    const shardStartDate = new Date(baseEpoch + (i - 1) * stepMs).toISOString().split('T')[0];
    const shardEndDate = new Date(baseEpoch + i * stepMs).toISOString().split('T')[0];
    const yearPart = shardStartDate.slice(0, 4);

    shards.push({
      id: `shard_${shardNum}`,
      name: `shard_${shardNum}.parquet`,
      node_origin: `https://edge-node-${String(((i - 1) % 64) + 1).padStart(2, '0')}.lake.pages.dev`,
      rows: rowsPerShard,
      sizeMB,
      row_groups: 200,
      zone_map: {
        min_id: '', // filled by reindexShards
        max_id: '',
        date_min: shardStartDate,
        date_max: shardEndDate,
        year_partitions: [yearPart],
        regions: [primaryRegion, secondaryRegion],
        categories: [category1, category2],
        batch_id: batchId,
        metric_alpha_avg: Math.round((240 + Math.sin(i * 0.4) * 85) * 100) / 100,
        metric_beta_avg: Math.round((85 + Math.cos(i * 0.3) * 32) * 100) / 100
      }
    });
  }

  const indexed = reindexShards(shards);

  return {
    lake_name: 'Cloudflare Serverless Infinite Lake',
    cluster_id: 'cluster-edge-mesh-10b',
    last_updated: new Date().toISOString(),
    shards: indexed
  };
}

/**
 * Creates a new shard from a user-supplied Cloudflare Pages URL
 */
export function createCustomShard(
  existingShardsCount: number,
  params: {
    nodeOrigin: string;
    shardName?: string;
    rows?: number;
    sizeMB?: number;
    region?: string;
    category?: string;
    batchId?: string;
    dateMin?: string;
    dateMax?: string;
  }
): StorageShard {
  const nextNum = existingShardsCount + 1;
  const shardId = `shard_${String(nextNum).padStart(4, '0')}`;
  const rows = params.rows || 50_000_000;
  const sizeMB = params.sizeMB || 490;
  const region = params.region || PARTITION_REGIONS[nextNum % PARTITION_REGIONS.length];
  const category = params.category || CATEGORY_DICTIONARY[nextNum % CATEGORY_DICTIONARY.length];
  const batchId = params.batchId || `BATCH-${new Date().getFullYear()}-CUSTOM`;
  const dateMin = params.dateMin || '2026-01-01';
  const dateMax = params.dateMax || '2026-10-31';

  return {
    id: shardId,
    name: params.shardName || `${shardId}.parquet`,
    node_origin: params.nodeOrigin.trim(),
    rows,
    sizeMB,
    row_groups: Math.max(1, Math.floor(rows / 250_000)),
    start_row: 0, // reindex will recalculate
    end_row: 0,
    zone_map: {
      min_id: '',
      max_id: '',
      date_min: dateMin,
      date_max: dateMax,
      year_partitions: [dateMin.slice(0, 4), dateMax.slice(0, 4)],
      regions: [region],
      categories: [category],
      batch_id: batchId,
      metric_alpha_avg: 275.4,
      metric_beta_avg: 92.1
    }
  };
}

/**
 * Batch scale cluster by adding N shards (e.g. +20 shards = +1B rows, +1000 shards = +50B rows)
 */
export function batchScaleCluster(
  currentShards: StorageShard[],
  addCount: number,
  rowsPerShard = 50_000_000
): StorageShard[] {
  const startIdx = currentShards.length;
  const newShards: Omit<StorageShard, 'start_row' | 'end_row'>[] = [];
  const baseEpoch = new Date('2025-06-01T00:00:00Z').getTime();
  const stepMs = 3 * 86400 * 1000;

  for (let i = 1; i <= addCount; i++) {
    const globalIdx = startIdx + i;
    const shardNum = String(globalIdx).padStart(4, '0');
    const sizeMB = 480 + ((globalIdx * 11) % 40);
    const region1 = PARTITION_REGIONS[(globalIdx - 1) % PARTITION_REGIONS.length];
    const region2 = PARTITION_REGIONS[(globalIdx + 2) % PARTITION_REGIONS.length];
    const cat = CATEGORY_DICTIONARY[(globalIdx - 1) % CATEGORY_DICTIONARY.length];
    const batchId = BATCH_IDS[(globalIdx - 1) % BATCH_IDS.length];

    const dMin = new Date(baseEpoch + (globalIdx % 300) * stepMs).toISOString().split('T')[0];
    const dMax = new Date(baseEpoch + ((globalIdx % 300) + 1) * stepMs).toISOString().split('T')[0];

    newShards.push({
      id: `shard_${shardNum}`,
      name: `shard_${shardNum}.parquet`,
      node_origin: `https://edge-node-${String(((globalIdx - 1) % 128) + 1).padStart(3, '0')}.lake.pages.dev`,
      rows: rowsPerShard,
      sizeMB,
      row_groups: Math.max(1, Math.floor(rowsPerShard / 250_000)),
      zone_map: {
        min_id: '',
        max_id: '',
        date_min: dMin,
        date_max: dMax,
        year_partitions: [dMin.slice(0, 4)],
        regions: [region1, region2],
        categories: [cat],
        batch_id: batchId,
        metric_alpha_avg: Math.round((260 + Math.sin(globalIdx * 0.3) * 70) * 100) / 100,
        metric_beta_avg: Math.round((90 + Math.cos(globalIdx * 0.25) * 25) * 100) / 100
      }
    });
  }

  // Combine with existing and reindex seamlessly
  return reindexShards([...currentShards, ...newShards]);
}
