/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { X, FolderGit2, Copy, Download } from 'lucide-react';
import { StorageShard } from '../types/datalake.ts';

interface CatalogManifestModalProps {
  isOpen: boolean;
  onClose: () => void;
  allShards: StorageShard[];
  lakeName: string;
  totalRows: number;
  totalMB: number;
  onCopyText: (text: string, label: string) => void;
}

export const CatalogManifestModal: React.FC<CatalogManifestModalProps> = ({
  isOpen,
  onClose,
  allShards,
  lakeName,
  totalRows,
  totalMB,
  onCopyText
}) => {
  if (!isOpen) return null;

  const catalogJSON = {
    lake_name: lakeName,
    cluster_type: 'infinite_horizontally_scalable_mesh',
    total_shards: allShards.length,
    total_estimated_rows: totalRows,
    total_storage_size: `${(totalMB / 1024).toFixed(1)} GB`,
    total_storage_mb: totalMB,
    last_synced: new Date().toISOString(),
    shards: allShards.map((s) => ({
      id: s.id,
      name: s.name,
      node_origin: s.node_origin,
      rows: s.rows,
      size: `${s.sizeMB} MB`,
      start_row: s.start_row,
      end_row: s.end_row,
      zone_map: s.zone_map
    }))
  };

  const jsonString = JSON.stringify(catalogJSON, null, 2);

  const handleDownload = () => {
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'catalog.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl rounded-2xl bg-zinc-900 border border-zinc-700/80 shadow-2xl p-5 space-y-4"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div className="flex items-center gap-2">
            <FolderGit2 className="w-4 h-4 text-indigo-400" />
            <h3 className="text-sm font-semibold text-zinc-100">
              动态 /lake/catalog.json 分布式分片元数据 ({allShards.length} Shards · {totalRows.toLocaleString()} Rows)
            </h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[420px] overflow-y-auto rounded-xl bg-zinc-950 border border-zinc-800 p-4 font-mono text-xs text-indigo-200 leading-relaxed">
          <pre className="whitespace-pre-wrap">{jsonString}</pre>
        </div>

        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-zinc-400">
            每个 Cloudflare Pages 边缘节点通过 HTTP Range 206 实现分片毫秒级读取
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownload}
              className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 font-medium flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>下载 JSON</span>
            </button>
            <button
              onClick={() => onCopyText(jsonString, 'catalog.json')}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs text-white font-medium flex items-center gap-1.5"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>复制 JSON</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
