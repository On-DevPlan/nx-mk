# nx-mk Spec: Phase 4.5 — Dashboard 可操作化（Replay Request / plugin settings 只读 / SSE 桥 / manifest 浏览器）

> 日期：2026-09-20
> 范围：Dashboard 从只读控制台升级为可操作控制台——Replay Request（安全三分类 + 留痕）、plugin settings 只读装配 + YAML 片段生成、SSE 事件桥（4 类事件文件 tail）、manifest 浏览器页
> 不在范围：plugin config YAML 直接写回 mk.config.yml（§31 原文写回，待 v1 原子写回链）、Replay Scenario（§26 DSL 运行器未建）、SSE 全量 RunState 聚合 + stage:progress、agent iterations 页、policy 编辑器、/settings/replay 编辑页、metrics-from-db 回算
> 关联文档：
> - `docx/plan/nx-mk-plan.md`（§15 RunState/SSE、§26 DSL、§27 Replay、§30 Dashboard 页面、§31 插件设置）
> - `docs/superpowers/specs/2026-09-17-nx-mk-phase4-dashboard-design.md`（既有 Dashboard 架构——纯只读铁律 D6、轮询架构 D3、单包双构建 D4）
> - `docs/hygiene-backlog.md`（B4/B7 collector 重写备忘，推 Phase 5.5；不属本期）

---

## 1. 目标与范围

### 1.1 一句话

Dashboard 新增四能力：POST replay 发真 HTTP 请求（服务端安全三分类把关 + `.nx-mk/replays/` 留痕）、插件配置只读可视 + YAML 片段生成器、SSE 实时事件流（桥接既有 event-bus 落盘事件）、manifest 树 + schema 表只读浏览。

### 1.2 用户裁定记录（2026-09-20 四问四答）

| # | 问题 | 裁定 |
|---|---|---|
| U1 | Phase 4.5 四块范围 | **全四块**（Replay §27 / settings §31 / SSE §15 / manifest 页 §30.1） |
| U2 | Replay 深度 | **只做 Replay Request**；Scenario replay 依赖 §26 DSL 运行器，推至 DSL 实现后 |
| U3 | plugin settings 写回 | **只读 + YAML 片段生成**（不破 Phase 4 D6 只读铁律；写回链 v1 立项） |
| U4 | SSE 深度 | **先接 4 类事件**（stage:start/done、request:captured、agent:iteration——内核已发、零内核改动）；全量 RunState + stage:progress 推 6.0 |
| U5 | Replay 留痕 | **留痕 + 确认门**：`.nx-mk/replays/` 目录留 JSON 痕（server 首个非只读产物，铁律扩展声明）+ unsafe 显式 confirm |
| U6 | manifest 页深度 | **树 + schema 表**（endpoints 树 + schema 字段表格 + policyStatus 徽章） |

### 1.3 本期设计裁定（spec 级）

| # | 裁定 | 理由 / 代价 |
|---|---|---|
| R1 | Replay 安全分类在**服务端**做 | 客户端判别可绕过；UI 只渲染 verdict 徽章与确认门 |
| R2 | 铁律收缩声明：Phase 4「三来源只读」→「三来源只读 + `.nx-mk/replays/` 留痕写」 | replay 是首个 server 写产物；留痕文件与三来源数据无关，不进 coverage.db |
| R3 | Replay 不写 coverage.db、不触发 proxy/browser 重采集 | 纯 HTTP 复刻语义；审计留痕在独立 replays 目录 |
| R4 | Replay 网络层失败 → 200 `{status:'replay-error', error}` | replay 失败是业务结果非 server 故障；HTTP 层不映射 500 |
| R5 | 留痕文件含 verdict + 请求快照（reqBody 截断 500 字符脱敏）+ 响应摘要 | 供 UI 回看 + 5.5 Scenario replay 复用 |
| R6 | PATCH /api/plugins/:name/config 不实现 | 只读 + YAML 片段生成替代；v1 需原子写 + 备份 + diff 预览，独立立项 |
| R7 | kernel 在 initPlugins 后一次性写 `.nx-mk/plugins-manifest.json`（name/version/config/configSchema JSON Schema 化） | 与 events.jsonl 同级的 kernel 侧产物；dashboard 只读消费 |
| R8 | 无 configSchema 插件仍列出，显「No schema exposed」 | 覆盖内置非 zod 插件 |
| R9 | SSE 桥 = 对 `.nx-mk/runs/**/events.jsonl` 的**文件 tail**（fs.watch，降级轮询） | run 与 dashboard 是跨进程语义；订阅进程内存 bus 不可行；零新依赖（D2 五件套不动） |
| R10 | 未知事件 type 忽略（向前兼容） | events.jsonl 持续演进不炸 SSE |
| R11 | UI usePolling 渐切 EventSource，失败自动降级回轮询；轮询通道不删 | SSE 断线自愈 + 既有测试资产保留 |

---

## 2. 架构

### 2.1 数据流

```
【Replay】请求详情页 [Replay request] → POST /api/runs/:runId/replay/request/:requestId {confirm?}
  server replay.ts：§27.2 分类 → blocked→403 / unsafe 无 confirm→409 / 放行 fetch 复刻
  → .nx-mk/replays/<runId>/<requestId>-<ts>.json 留痕 → 200 {replayId, verdict, ok, status?, durationMs?, bodyPreview?}

【Settings】kernel initPlugins 后写 plugins-manifest.json（R7）
  → GET /api/plugins 只读装配 [{name, version, enabled, config, schema}]
  → UI 插件卡片 + configSchema 驱动的 YAML 片段生成器（仅 UI 侧，复制导出）

【SSE】GET /api/events（text/event-stream）
  server event-tail.ts：fs.watch(.nx-mk/runs/**/events.jsonl) 追加行 → 解析 JSONL
  → 过滤 4 类事件（stage:start / stage:done / request:captured / agent:iteration）
  → SSE 推送；未知 type 忽略（R10）；watch 失败降级 500ms 轮询 tail
  UI：usePolling → useEventSource 渐切（R11），SSE 事件驱动 Overview/RunOverview 即时刷新

【Manifest】GET /api/runs/:runId/manifest（.nx-mk/runs/<id>/manifest.json 只读）
  UI /runs/:runId/manifest：左 endpoints 树（method 徽章 / called / 字段数）
  → 右 schema 表（字段 / 类型 / required / policyStatus 徽章）→ 行锚点链 fields 页
```

### 2.2 包改动面

```
packages/kernel/src/        # R7：initPlugins 后写 plugins-manifest.json（~30 行）
packages/dashboard/src/
  server/replay.ts          # 新：安全分类 + fetch 复刻 + 留痕
  server/event-tail.ts      # 新：events.jsonl 文件 tail → SSE
  server/routes/{replay,plugins,events,manifest}.ts   # 新路由 4 条
  store/plugins-reader.ts   # 新：plugins-manifest.json 形状门控读取
  ui/pages/ManifestBrowser.tsx                            # 新页面
  ui/pages/RequestDetail.tsx（Replay 行 + verdict 徽章扩展）
  ui/pages/PluginSettings.tsx                             # 新页面
  ui/hooks.ts               # useEventSource（usePolling 旁路新增，不替换）
packages/dashboard/__tests__/ → replay / event-tail / plugins-reader / manifest 路由测试
```

### 2.3 API 增量（对照 §30.2 全集）

```
POST /api/runs/:runId/replay/request/:requestId     # ✅ 本期（body {confirm?}）
GET  /api/runs/:runId/replays                        # ✅ 本期（留痕列表，§30.2 未列——v0 扩展）
GET  /api/runs/:runId/manifest                       # ✅ 本期
GET  /api/plugins                                    # ✅ 本期（R6：只读装配）
PATCH /api/plugins/:pluginName/config                # ❌ 推 v1（R6）
GET  /api/events                                     # ✅ 本期（SSE，4 类事件）
POST /api/runs/:runId/replay/scenario/:scenarioId    # ❌ 待 §26 DSL
PATCH /api/settings/{policy,agent,replay}            # ❌ 编辑器推后
```

---

## 3. 错误处理

| # | 场景 | 行为 |
|---|---|---|
| E1 | replay verdict=blocked | 403 + 敏感路径文案（§27.3 原文） |
| E2 | replay verdict=unsafe 无 confirm | 409 + "unsafe method requires confirmation" |
| E3 | replay fetch 超时/dns 失败/conn refused | 200 replay-error（R4），留痕 error 状态 |
| E4 | plugins-manifest.json 缺失/形状不过 | GET /api/plugins 返回空数组 + `stale:false→stale:true` 标志（与 report 缺失降级语义同构） |
| E5 | configSchema 非 JSON Schema 可序列化 | 整字段置 null，YAML 生成器降级「无 schema 自由编辑」 |
| E6 | fs.watch 不可用（Windows 目录递归语义差异） | event-tail 降级 500ms 目录轮询 tail——行为等价 |
| E7 | events.jsonl 损坏行 | 跳过该行（R10 前向兼容），不炸流 |
| E8 | manifest.json 缺小于 runId 形状门 | 404（对齐既有 run 路由语义） |

## 4. 测试策略

| 层 | 要点 |
|---|---|
| replay 分类 | 三分类矩阵（GET/PUT+key/POST/PATCH/DELETE×敏感路径）+ blocked/unsafe 无 confirm 拒绝 + fetch mock 复刻参数快照 + replay-error 200 语义 + 留痕文件形状 |
| event-tail | JSONL 追加 → 4 类过滤 → 未知 type 跳过 → fs.watch mock 与轮询降级等价 |
| plugins-reader | 形状门控 + E4 降级 + configSchema null 化（E5） |
| manifest 路由 | 读取/404/形状门 |
| SSE 端到端 | fastify inject + 真 fixture events.jsonl 追加 → 断言事件收到 |
| UI | Replay 行渲染 verdict 徽章 / YAML 片段生成器类型分支 / Manifest 树折叠 + 徽章 / useEventSource 降级 |
| 集成 | demo 手动验收（README 记步骤） |

环境约束沿袭：Windows + Git Bash；`corepack pnpm`；`npx vitest run`；PATH 前缀 node v22；≤400 行/文件；中文注释、英文 CLI/测试；不写 attribution 行。

## 5. 验收

1. 全套 vitest 绿（502 → 预计 +50±15）
2. demo 手动验收：起三服务 → run → dashboard 请求详情点 Replay → safe 直接成功留痕；构造 unsafe 方法 → 无 confirm 409 / confirm 后成功；/api/events curl 看到 stage:start/done；/runs/:id/manifest 树浏览；/settings/plugins 可见内置插件与 YAML 片段复制
3. 只读铁律核查：除 `.nx-mk/replays/`（R2 收缩项）与 `.nx-mk/plugins-manifest.json`（R7 kernel 产物）外，dashboard server 对既有三来源零写路径（grep 核查）
4. D2 五依赖不破（SSE/event-tail/留痕零新包）
