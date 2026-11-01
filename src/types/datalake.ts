/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ShardZoneMap {
  min_id: string;
  max_id: string;
  date_min: string;
  date_max: string;
  year_partitions: string[];
  regions: string[];
  categories: string[];
  batch_id: string;
  metric_alpha_avg: number;
  metric_beta_avg: number;
}

export interface StorageShard {
  id: string;
  name: string;
  node_origin: string; // e.g., "https://node01.lake.pages.dev"
  rows: number;
  sizeMB: number;
  row_groups: number;
  start_row: number; // Dynamically computed cumulative starting global row
  end_row: number;   // Dynamically computed cumulative ending global row
  zone_map: ShardZoneMap;
}

export interface LakeClusterCatalog {
  lake_name: string;
  cluster_id: string;
  last_updated: string;
  shards: StorageShard[];
}

export interface PartitionFilter {
  id: string;
  field: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'gt' | 'lt';
  value: string;
}

export interface ColumnDef {
  key: string;
  label: string;
  type: 'string' | 'number' | 'date' | 'boolean';
  bytesPerVal: number;
}

export interface DecodedRow {
  _global_row_num: number;
  _shard_id: string;
  _node_origin: string;
  _row_group: number;
  record_id: string;
  partition_key: string;
  event_timestamp: string;
  region_zone: string;
  category_code: string;
  status_flag: string;
  metric_alpha: number;
  metric_beta: number;
  is_verified: boolean;
  payload_hash: string;
  [key: string]: string | number | boolean;
}

export interface PruningResult {
  activeShards: StorageShard[];
  activeShardIds: Set<string>;
  prunedShardsCount: number;
  prunedRatio: number; // 0 - 100%
  totalClusterRows: number;
  totalClusterMB: number;
  activeRowsPool: number;
  estimatedMatchedRows: number;
}
