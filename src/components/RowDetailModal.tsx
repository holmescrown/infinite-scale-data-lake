/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { X, Copy, Calendar, CheckSquare } from 'lucide-react';
import { DecodedRow, ColumnDef } from '../types/datalake.ts';

interface RowDetailModalProps {
  row: DecodedRow | null;
  onClose: () => void;
  columns: readonly ColumnDef[];
  onCopyText: (text: string, label: string) => void;
}

export const RowDetailModal: React.FC<RowDetailModalProps> = ({
  row,
  onClose,
  columns,
  onCopyText
}) => {
  if (!row) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl bg-zinc-900 border border-zinc-800 shadow-2xl p-5 space-y-4 text-xs"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">
              单行记录详情 · 全湖第 #{row._global_row_num?.toLocaleString()} 行
            </h3>
            <p className="text-[11px] font-mono text-zinc-400 mt-0.5 truncate max-w-sm">
              物理分片: {row._shard_id}.parquet @ {row._node_origin} (RowGroup #{row._row_group})
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto divide-y divide-zinc-800/60">
          {columns.map((col) => {
            const val = row[col.key];
            return (
              <div key={col.key} className="py-2.5 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-zinc-400">
                  <span className="font-mono text-[11px]">{col.label}</span>
                </div>
                <div
                  onClick={() => onCopyText(String(val ?? ''), col.key)}
                  className="font-mono text-zinc-100 cursor-pointer hover:text-indigo-300 truncate max-w-[260px]"
                  title="点击复制此字段值"
                >
                  {String(val ?? '')}
                </div>
              </div>
            );
          })}
        </div>

        <div className="pt-2 flex justify-end gap-2">
          <button
            onClick={() => onCopyText(JSON.stringify(row, null, 2), '该行完整数据')}
            className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs text-white font-medium flex items-center gap-1.5"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>复制行 JSON</span>
          </button>
        </div>
      </div>
    </div>
  );
};
