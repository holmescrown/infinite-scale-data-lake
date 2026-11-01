/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { StorageShard, PartitionFilter, PruningResult } from '../types/datalake.ts';

/**
 * Intelligent Partition Pruning Engine
 * Pre-checks ZoneMap Min/Max statistics, region bitmasks, date intervals, and
 * batch IDs before any shard network query is triggered.
 *
 * Automatically skips unhit shards and strictly confines concurrency to active shards.
 */
export function evaluatePartitionPruning(
  allShards: StorageShard[],
  filters: PartitionFilter[],
  globalSearch: string,
  selectedShardId: string = 'ALL_SHARDS'
): PruningResult {
  const totalClusterRows = allShards.reduce((acc, s) => acc + s.rows, 0);
  const totalClusterMB = allShards.reduce((acc, s) => acc + s.sizeMB, 0);

  // Step 1: Base selection
  let candidateShards =
    selectedShardId === 'ALL_SHARDS'
      ? allShards
      : allShards.filter((s) => s.id === selectedShardId);

  // Step 2: ZoneMap boundary pruning against user filters
  filters.forEach((f) => {
    const val = f.value?.trim().toLowerCase();
    if (!val) return;

    if (f.field === 'region_zone') {
      if (f.operator === 'equals') {
        candidateShards = candidateShards.filter((s) =>
          s.zone_map.regions.some((r) => r.toLowerCase() === val)
        );
      } else if (f.operator === 'not_equals') {
        candidateShards = candidateShards.filter(
          (s) => !s.zone_map.regions.every((r) => r.toLowerCase() === val)
        );
      }
    } else if (f.field === 'category_code') {
      if (f.operator === 'equals') {
        candidateShards = candidateShards.filter((s) =>
          s.zone_map.categories.some((c) => c.toLowerCase() === val)
        );
      } else if (f.operator === 'not_equals') {
        candidateShards = candidateShards.filter(
          (s) => !s.zone_map.categories.every((c) => c.toLowerCase() === val)
        );
      }
    } else if (f.field === 'batch_id' || f.field === 'partition_key') {
      if (f.operator === 'equals') {
        candidateShards = candidateShards.filter(
          (s) => s.zone_map.batch_id.toLowerCase() === val || s.id.toLowerCase() === val
        );
      } else if (f.operator === 'contains') {
        candidateShards = candidateShards.filter(
          (s) =>
            s.zone_map.batch_id.toLowerCase().includes(val) ||
            s.id.toLowerCase().includes(val) ||
            s.name.toLowerCase().includes(val)
        );
      }
    } else if (f.field === 'event_timestamp') {
      if (f.operator === 'gt') {
        // Shard max date must be greater than filter date
        candidateShards = candidateShards.filter((s) => s.zone_map.date_max > f.value);
      } else if (f.operator === 'lt') {
        // Shard min date must be less than filter date
        candidateShards = candidateShards.filter((s) => s.zone_map.date_min < f.value);
      } else if (f.operator === 'equals') {
        candidateShards = candidateShards.filter(
          (s) => s.zone_map.date_min <= f.value && s.zone_map.date_max >= f.value
        );
      }
    } else if (f.field === 'record_id') {
      const numericId = Number(String(f.value).replace(/\D/g, ''));
      if (!isNaN(numericId) && numericId > 0) {
        candidateShards = candidateShards.filter(
          (s) => numericId >= s.start_row && numericId <= s.end_row
        );
      }
    }
  });

  // Step 3: Compute selectivity and active rows pool
  const activeRowsPool = candidateShards.reduce((acc, s) => acc + s.rows, 0);

  let selectivity = 1.0;
  const hasExactIdFilter = filters.some((f) => f.field === 'record_id' && f.operator === 'equals');

  filters.forEach((f) => {
    if (f.field === 'status_flag' && f.operator === 'equals') selectivity *= 0.2;
    else if (f.field === 'is_verified') selectivity *= 0.75;
    else if (f.operator === 'contains') selectivity *= 0.2;
    else if (f.operator === 'gt' || f.operator === 'lt') selectivity *= 0.45;
  });

  if (globalSearch.trim() !== '') {
    selectivity *= 0.15;
  }

  const estimatedMatchedRows =
    candidateShards.length === 0
      ? 0
      : hasExactIdFilter
      ? 1
      : Math.max(1, Math.floor(activeRowsPool * selectivity));

  const prunedShardsCount = allShards.length - candidateShards.length;
  const prunedRatio =
    allShards.length > 0
      ? Math.round((prunedShardsCount / allShards.length) * 1000) / 10
      : 0;

  const activeShardIds = new Set(candidateShards.map((s) => s.id));

  return {
    activeShards: candidateShards,
    activeShardIds,
    prunedShardsCount,
    prunedRatio,
    totalClusterRows,
    totalClusterMB,
    activeRowsPool,
    estimatedMatchedRows
  };
}
