/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Database, Plus, Upload, Download, FolderGit2, Cpu } from 'lucide-react';

interface HeaderProps {
  totalRows: number;
  totalShards: number;
  onOpenMountModal: () => void;
  onOpenCatalogModal: () => void;
  onExportCSV: () => void;
  onImportLocalFileClick: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  totalRows,
  totalShards,
  onOpenMountModal,
  onOpenCatalogModal,
  onExportCSV,
  onImportLocalFileClick
}) => {
  return (
    <header className="sticky top-0 z-30 h-14 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between">
      {/* Brand Zone */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
          <Database className="w-4 h-4" />
        </div>
        <div className="flex items-center gap-2.5">
          <h1 className="text-sm font-semibold tracking-tight text-zinc-100 whitespace-nowrap">
            无限横向扩展数据湖 (Infinite Data Lake)
          </h1>
          <span className="hidden lg:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            已注册 {totalShards} 存储节点 · {totalRows.toLocaleString()} 行资产已挂载
          </span>
        </div>
      </div>

      {/* Primary Actions Zone */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onOpenMountModal}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white transition-all shadow-sm active:scale-95"
          title="动态外挂新的 Cloudflare Pages 存储节点或弹性扩容"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>外挂节点 / 弹性扩容</span>
        </button>

        <button
          onClick={onImportLocalFileClick}
          className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-300 transition-all active:scale-95"
          title="导入本地 CSV 或 JSON 分区数据"
        >
          <Upload className="w-3.5 h-3.5 text-zinc-400" />
          <span>导入本地表</span>
        </button>

        <button
          onClick={onExportCSV}
          className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-300 transition-all active:scale-95"
          title="导出当前视窗数据为 CSV"
        >
          <Download className="w-3.5 h-3.5 text-zinc-400" />
          <span>导出视窗</span>
        </button>

        <button
          onClick={onOpenCatalogModal}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-400 hover:text-zinc-100 transition-all"
          title="查看全局动态 /lake/catalog.json 元数据清单"
        >
          <FolderGit2 className="w-3.5 h-3.5 text-indigo-400" />
          <span className="hidden xl:inline font-mono text-[11px]">catalog.json</span>
        </button>
      </div>
    </header>
  );
};
