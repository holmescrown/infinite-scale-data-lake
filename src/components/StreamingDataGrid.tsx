/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Maximize2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Calendar,
  CheckSquare
} from 'lucide-react';
import { DecodedRow, ColumnDef } from '../types/datalake.ts';

interface StreamingDataGridProps {
  rows: DecodedRow[];
  visibleColumns: ColumnDef[];
  cursorOffset: number;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
  totalEstimatedRows: number;
  hitShardLabel: string;
  hitNodeOrigin: string;
  sortField: string;
  sortOrder: 'asc' | 'desc';
  onSortColumn: (key: string) => void;
  selectedRowId: string | null;
  onSelectRow: (id: string) => void;
  onInspectRow: (row: DecodedRow) => void;
  onJumpToRow: (rowNum: number) => void;
  onCopyText: (text: string, label: string) => void;
}

function FieldTypeBadge({ type }: { type: ColumnDef['type'] }) {
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
          title="布尔 (Boolean)"
        >
          <CheckSquare className="w-2.5 h-2.5" />
        </span>
      );
    default:
      return (
        <span
          className="inline-flex items-center justify-center w-4 h-4 rounded bg-indigo-500/10 text-indigo-400 font-sans text-[10px] font-semibold shrink-0"
          title="文本 (String)"
        >
          Aa
        </span>
      );
  }
}

export const StreamingDataGrid: React.FC<StreamingDataGridProps> = ({
  rows,
  visibleColumns,
  cursorOffset,
  pageSize,
  onPageSizeChange,
  totalEstimatedRows,
  hitShardLabel,
  hitNodeOrigin,
  sortField,
  sortOrder,
  onSortColumn,
  selectedRowId,
  onSelectRow,
  onInspectRow,
  onJumpToRow,
  onCopyText
}) => {
  return (
    <section className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 overflow-hidden flex flex-col shadow-sm">
      <div className="w-full overflow-x-auto max-h-[540px] overflow-y-auto select-none">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 z-20 bg-zinc-900/95 backdrop-blur border-b border-zinc-800 text-zinc-300">
            <tr>
              <th className="py-2.5 px-3 font-mono text-[11px] text-zinc-500 border-r border-zinc-800/60 w-32 whitespace-nowrap">
                全湖游标行号
              </th>
              {visibleColumns.map((col) => {
                const isSorted = sortField === col.key;
                return (
                  <th
                    key={col.key}
                    onClick={() => onSortColumn(col.key)}
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
                          <ArrowUpDown className="w-3 h-3 opacity-30" />
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
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={visibleColumns.length + 2}
                  className="py-24 text-center text-zinc-500"
                >
                  当前分区裁剪条件下无命中分片或数据记录，请放宽筛选规则。
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => {
                const rowNum = row._global_row_num || cursorOffset + idx + 1;
                const isSelected = selectedRowId === row.record_id;
                return (
                  <tr
                    key={row.record_id || idx}
                    onClick={() => onSelectRow(row.record_id)}
                    className={`h-9 border-b border-zinc-800/40 transition-colors ${
                      isSelected
                        ? 'bg-indigo-500/15 text-zinc-100'
                        : idx % 2 === 1
                        ? 'bg-zinc-900/25 hover:bg-zinc-800/40'
                        : 'hover:bg-zinc-800/40'
                    }`}
                  >
                    <td className="px-3 font-mono tabular-nums text-[11px] text-zinc-500 border-r border-zinc-800/30 whitespace-nowrap">
                      #{rowNum.toLocaleString()}
                    </td>
                    {visibleColumns.map((col) => {
                      const val = row[col.key];
                      return (
                        <td
                          key={col.key}
                          onDoubleClick={() => onCopyText(String(val ?? ''), col.key)}
                          className={`px-4 border-r border-zinc-800/30 last:border-r-0 whitespace-nowrap truncate max-w-[260px] ${
                            col.type === 'number'
                              ? 'font-mono tabular-nums text-emerald-300/90 text-right'
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
                          onInspectRow(row);
                        }}
                        className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200 transition-colors"
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
            <strong className="text-zinc-100 font-mono tabular-nums">
              {(cursorOffset + 1).toLocaleString()} -{' '}
              {Math.min(totalEstimatedRows, cursorOffset + rows.length).toLocaleString()}
            </strong>{' '}
            / 共{' '}
            <strong className="text-indigo-400 font-mono tabular-nums">
              {totalEstimatedRows.toLocaleString()}
            </strong>{' '}
            行
          </span>
          <span className="hidden md:inline text-zinc-600">|</span>
          <span className="hidden md:inline font-mono text-[11px] text-zinc-400 truncate max-w-sm">
            节点源: <strong className="text-emerald-400">{hitShardLabel}</strong> ({hitNodeOrigin})
          </span>
        </div>

        {/* Cursor Controls */}
        <div className="flex items-center gap-2">
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="px-2 py-1 rounded bg-zinc-950 border border-zinc-800 text-xs text-zinc-200"
          >
            <option value={50}>50 行 / 视窗</option>
            <option value={100}>100 行 / 视窗</option>
          </select>

          <div className="flex items-center gap-1">
            <button
              onClick={() => onJumpToRow(1)}
              disabled={cursorOffset === 0}
              className="p-1.5 rounded bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 disabled:opacity-30 disabled:pointer-events-none"
              title="跳至首行"
            >
              <ChevronsLeft className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onJumpToRow(Math.max(1, cursorOffset - pageSize + 1))}
              disabled={cursorOffset === 0}
              className="px-2.5 py-1 rounded bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 disabled:opacity-30 disabled:pointer-events-none flex items-center gap-1"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>上一视窗</span>
            </button>
            <button
              onClick={() =>
                onJumpToRow(
                  Math.min(
                    Math.max(1, totalEstimatedRows - pageSize + 1),
                    cursorOffset + pageSize + 1
                  )
                )
              }
              disabled={cursorOffset + pageSize >= totalEstimatedRows}
              className="px-2.5 py-1 rounded bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 disabled:opacity-30 disabled:pointer-events-none flex items-center gap-1"
            >
              <span>下一视窗</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() =>
                onJumpToRow(Math.max(1, totalEstimatedRows - pageSize + 1))
              }
              disabled={cursorOffset + pageSize >= totalEstimatedRows}
              className="p-1.5 rounded bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 disabled:opacity-30 disabled:pointer-events-none"
              title="跳至末尾视窗"
            >
              <ChevronsRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
