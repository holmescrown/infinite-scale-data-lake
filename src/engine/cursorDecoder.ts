/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { StorageShard, DecodedRow, PartitionFilter, ColumnDef } from '../types/datalake.ts';
import { CATEGORY_DICTIONARY, STATUS_DICTIONARY } from './clusterCatalog.ts';

/**
 * Binary search to locate which shard holds a given global row number
 */
export function findShardForGlobalRow(
  activeShards: StorageShard[],
  targetRow: number
): { shard: StorageShard; index: number } | null {
  if (activeShards.length === 0) return null;

  let low = 0;
  let high = activeShards.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const s = activeShards[mid];

    if (targetRow >= s.start_row && targetRow <= s.end_row) {
      return { shard: s, index: mid };
    } else if (targetRow < s.start_row) {
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  // Fallback to nearest boundary if outside
  if (targetRow < activeShards[0].start_row) {
    return { shard: activeShards[0], index: 0 };
  }
  return {
    shard: activeShards[activeShards.length - 1],
    index: activeShards.length - 1
  };
}

/**
 * Fast O(1) deterministic row synthesizer for any row (1 .. 100,000,000,000+)
 * Uses 32-bit Murmur-style mixing so each row has consistent, realistic values.
 */
export function decodeSingleVirtualRow(
  globalRowNumber: number,
  shard: StorageShard
): DecodedRow {
  let h = (globalRowNumber ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;

  const regions = shard.zone_map.regions.length ? shard.zone_map.regions : ['Zone-North'];
  const categories = shard.zone_map.categories.length ? shard.zone_map.categories : CATEGORY_DICTIONARY;
  
  const regionZone = regions[h % regions.length];
  const categoryCode = categories[(h >>> 3) % categories.length];
  const statusFlag = STATUS_DICTIONARY[(h >>> 6) % STATUS_DICTIONARY.length];

  // Interpolate date within shard's zone_map
  const minTime = new Date(shard.zone_map.date_min).getTime();
  const maxTime = new Date(shard.zone_map.date_max).getTime();
  const offsetRatio = (globalRowNumber - shard.start_row) / Math.max(1, shard.rows);
  const rowDate = new Date(minTime + offsetRatio * (maxTime - minTime))
    .toISOString()
    .split('T')[0];

  const rowGroup = Math.floor(((globalRowNumber - shard.start_row) / shard.rows) * shard.row_groups) + 1;
  const metricAlpha =
    Math.round(
      (shard.zone_map.metric_alpha_avg * 0.7 + ((h % 90000) / 100) + ((h & 15) * 1.5)) * 100
    ) / 100;
  const metricBeta =
    Math.round(
      (shard.zone_map.metric_beta_avg * 0.6 + (((h >>> 5) % 45000) / 100)) * 100
    ) / 100;

  const isVerified = (h & 3) !== 0;
  const hexHash = `0x${h.toString(16).padStart(8, '0')}${((h * 1664525) >>> 0)
    .toString(16)
    .padStart(8, '0')}`;

  return {
    _global_row_num: globalRowNumber,
    _shard_id: shard.id,
    _node_origin: shard.node_origin,
    _row_group: rowGroup,
    record_id: `REC-${String(globalRowNumber).padStart(12, '0')}`,
    partition_key: `${shard.id.toUpperCase()}_RG${String(rowGroup).padStart(3, '0')}`,
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

export function matchesRowFilters(
  row: DecodedRow,
  filters: PartitionFilter[],
  globalSearch: string,
  visibleCols: ColumnDef[]
): boolean {
  if (globalSearch.trim() !== '') {
    const q = globalSearch.toLowerCase().trim();
    let hit = false;
    for (let i = 0; i < visibleCols.length; i++) {
      const val = row[visibleCols[i].key];
      if (val !== undefined && val !== null && String(val).toLowerCase().includes(q)) {
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
