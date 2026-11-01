# 无限横向扩展（Infinite Horizontally Scalable）数据湖工作台架构方案

将现存数据湖探索器升级为彻底解耦存储容量上限、原生支持百亿至千亿行大数据资产的**无限横向扩展分布式检索架构**。实现智能分区裁剪（Partition Pruning）、多节点动态外挂注册与毫秒级 O(1) 视窗游标流式计算。

---

## User Review & Critical Decisions

> [!IMPORTANT]
> 基于第一轮澄清确认的技术与交互决策汇总如下：

- **节点外挂与扩容机制 (Confirmed)**：支持三种方式协同作业——UI 单节点 Cloudflare Pages URL 接入、批量 JSON 分区清单导入、以及 +10亿/+50亿/+500亿级一键弹性扩容预设。
- **智能分区裁剪展示 (Confirmed)**：采用分片拓扑矩阵（Topology Matrix）实时高亮活跃节点与裁剪率（Pruning Bypass Ratio），直观呈现零 I/O 规避的分片。
- **初始集群基准 (Confirmed)**：默认初始化为百亿级（10,000,000,000+ 行）分布式切片集群，并支持无感平滑弹性扩容至千亿行资产。

---

## 1. Overview & Core Concept

- **What It Does**: 提供一套无上限横向扩展的前端数据湖工作台，容量完全脱钩于静态代码，完全基于已注册的边缘存储节点（Cloudflare Pages / Object Storage）目录动态聚合计算。
- **Target Audience**: 数据平台工程师、大数据湖管理员与分析师，需在浏览器内秒级秒开、交互式过滤百亿甚至千亿级冷热分片资产。
- **Key Value**: 
  1. **零 OOM 崩溃**：无论数据湖扩展到 100 亿还是 1000 亿行，内存开销严格恒定在当前视窗（50~100 行，<100 KB）。
  2. **网络 I/O 极低**：借助 Zone Maps 先行比对元数据边界，在发起网络请求前裁剪掉 80%~99% 的无关分片。
  3. **动态热插拔**：随时外挂新增存储节点与批次清单，全湖行数、分片总量与大屏即时累加刷新。

---

## 2. User Experience & Visual Design

### Key User Flows
1. **全湖全景与容量概览**：进入工作台，顶部大屏动态聚合展示已注册节点的总行数（10B+ 起步）、已挂载分片数、总存储容量及当前裁剪规避率。
2. **动态外挂与批量扩容**：点击「挂载新节点 / 扩容集群」，在弹窗中可选择输入 Cloudflare Pages 存储节点 URL、粘贴/导入 JSON 目录清单，或一键注入千亿级批次集群，大屏指标立即响应刷新。
3. **多维条件与智能分区裁剪**：用户添加过滤条件（如特定 Zone 区域、时间区间、批次或 Record ID），裁剪引擎瞬间比对每个切片的 ZoneMap（Min-Max 统计），分片矩阵中未命中的节点立刻置灰（Pruned），网络请求严格限定于命中活跃分片。
4. **O(1) 流式视窗游标检索**：用户可任意跳转至第 1 行、第 50 亿行、第 100 亿行或末尾，系统毫秒级定位对应切片并解码渲染当前 50/100 行。
5. **算子下推聚合分析**：切换至分析视图，支持在不传输全量原始行的情况下，跨所有活跃分片执行 GROUP BY 与 SUM/AVG 下推聚合。

### Visual Identity & Theme
- **Aesthetic Direction**: 现代工业级数据系统控制台风格（Neutral Slate & Zinc 950 极深背景，点缀 Indigo 检索主色与 Emerald 活跃/健康状态色）。
- **Typography**: 
  - 界面标题与操作：`Plus Jakarta Sans` / `Outfit` 现代几何无衬线体。
  - 数据表格、行号、哈希与指标数字：严格使用 `font-mono tabular-nums`，确保垂直排版对齐。
- **Zero-Pill & Anti-Slop Discipline**:
  - 严禁滥用静态胶囊彩标签，元数据信息使用优雅的点号 `·` 间隔纯文本排版。
  - 状态矩阵使用微结构节点块网格，区分【当前读取节点】、【命中的活跃切片】与【被裁剪切片】。
- **Single-Elevation Depth**: 扁平化 1px 精细边框（`border-zinc-800`），避免卡片嵌套卡片的臃肿堆叠。

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: 存储容量完全解耦与动态聚合计算**
  - *Chosen Approach*: 彻底移除任何写死的全局行数或切片数量常量，数据湖元数据使用动态注册驱动的 `LakeClusterCatalog`。行数总计、存储体积与分片映射全部通过注册的节点集群动态规约计算（$\sum \text{rows}_i, \sum \text{bytes}_i$）。
  - *Why*: 彻底消除百亿/千亿扩展时的硬编码瓶颈，真正做到存储容量与应用代码彻底脱钩。
- **Decision 2: 前端先验智能分区裁剪（ZoneMap Partition Pruning）**
  - *Chosen Approach*: 在发起任何数据获取前，将 SQL 风格过滤规则（等于、区间、大于小于、包含）先与切片元数据的 `zone_map`（`[min_val, max_val]`、区域集合、时间范围、行号边界）进行先验布尔碰撞。未重叠的切片直接标记为裁剪跳过。
  - *Why*: 防止向边缘节点盲目发起海量 206 并发请求，将请求精准收敛到个位数活跃切片，大幅降低客户端网络压力与边缘流量费用。
- **Decision 3: 内存流式视窗（Zero-OOM Window）架构**
  - *Chosen Approach*: 坚持 O(1) 确定性伪随机/行组流式游标解码算法，内存中仅保留视窗所需 50~100 行数据对象，跨切片边界自动平滑跨越。
  - *Why*: 彻底规避百亿千亿规模下前端 JavaScript 堆内存溢出（OOM）风险。

---

## 4. Technical Architecture & Data Strategy

### System Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│                   Data Lake Dynamic Node Registry                      │
│   (Cluster Catalog: Dynamic Shard List with ZoneMaps & Node Origins)   │
└────────────────┬──────────────────────────────────────┬────────────────┘
                 │                                      │
                 ▼                                      ▼
   ┌───────────────────────────┐          ┌───────────────────────────┐
   │  Dynamic Mount / Import   │          │ Partition Pruning Engine  │
   │  • Cloudflare Pages URL   │          │ • ZoneMap Boundary Check  │
   │  • Batch JSON Manifest    │          │ • Min-Max Date/ID Ranges  │
   │  • 10B / 100B Scale Presets│         │ • Bypass Unhit Shards     │
   └─────────────┬─────────────┘          └─────────────┬─────────────┘
                 │                                      │
                 └──────────────────┬───────────────────┘
                                    │
                                    ▼
                 ┌──────────────────────────────────────┐
                 │       Active Partition Cluster       │
                 │   (Filtered Shards + Pruning Stats)  │
                 └──────────────────┬───────────────────┘
                                    │
                 ┌──────────────────┴──────────────────┐
                 ▼                                     ▼
┌─────────────────────────────────┐   ┌─────────────────────────────────┐
│  O(1) Streaming Window Cursor   │   │  Pushdown Aggregation Engine    │
│  • Memory footprint < 100 KB    │   │  • Group-By ZoneMap Summaries   │
│  • Strictly 50-100 Viewport Rows│   │  • Zero-Raw-Row Recharts Feed   │
│  • Arbitrary Jump (1 .. 100B)   │   │  • Sum / Avg / Min / Max Ops    │
└────────────────┬────────────────┘   └────────────────┬────────────────┘
                 │                                     │
                 ▼                                     ▼
   ┌───────────────────────────┐         ┌───────────────────────────┐
   │  High-Density Data Grid   │         │ Analytics Visualizer Area │
   └───────────────────────────┘         └───────────────────────────┘
```

### Data Structures & State Model

```typescript
// 动态切片元数据模型
interface ShardZoneMap {
  min_id: string;
  max_id: string;
  date_min: string;
  date_max: string;
  regions: string[];
  categories: string[];
  metric_alpha_avg: number;
  metric_beta_avg: number;
}

interface StorageShard {
  id: string;
  name: string;
  node_origin: string; // e.g., "node14.pages.dev"
  rows: number;
  sizeMB: number;
  row_groups: number;
  start_row: number; // 动态累加起始全局行号
  end_row: number;   // 动态累加结束全局行号
  zone_map: ShardZoneMap;
}

// 动态数据湖集群注册中心
interface DynamicLakeCluster {
  cluster_name: string;
  shards: StorageShard[];
  // 派生计算：total_rows = sum(shards.rows), total_mb = sum(shards.sizeMB)
}
```

### Key Handlers & Interactive Transitions
- `handleMountCustomNode(nodeUrl, partitionRange, rowCount)`: 校验 URL 并向当前数据湖追加新分片，动态修正全局行号偏移。
- `handleImportManifestJSON(jsonText)`: 批量解析并追加多个切片元数据，自动去重并按区间链式排序。
- `handleScalePreset(scaleMultiplier)`: 极速追加百亿或千亿切片批次，瞬时测试大规模拓扑响应。
- `evaluatePartitionPruning(filters, shards)`: 核心裁剪调度器，计算命中分片与裁剪跳过率。
- `handleJumpToRow(targetGlobalRow)`: 二分快速定位所在切片与切片内相对行偏移，毫秒级加载目标视窗。

---

## 5. Verification Plan

1. **容量脱钩测试**：初始加载百亿行规模（500 分片），验证大屏动态累加计算是否正确；执行动态外挂新节点与批量扩展后，确认总行数实时刷新且无性能卡顿。
2. **分区裁剪测试**：设置特定筛选条件（如 `region_zone = 'Zone-North'` 或 `record_id = 'REC-0500000000'`），验证分片矩阵高亮状态与裁剪率指标，确认未命中分片被正确隔离。
3. **百亿/千亿视窗定位**：测试跳转到第 1 行、第 1 亿行、第 50 亿行乃至 100 亿行，验证解码耗时均在 5ms 以内，无内存泄漏。
4. **编译与代码质量验证**：执行 `compile_applet`，确保 TypeScript 类型完备、零构建错误。
