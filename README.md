# nx-mk

> OpenAPI-driven frontend API/UI coverage analyzer with SDK Facade

通过 `npx nx-mk` 一键启动本地分析工作台：解析 OpenAPI → 生成 Manifest → 注入 SDK Facade → 采集 request/field-hit/UI-evidence → policy 判定 + coverage 分析 → 写报告 + goal 驱动终止。

## 当前状态

**Phase 3 分析完成** — policy-engine 全量（§21 优先级 + glob `*`/`**`/字面）、coverage analyzer §28 + 三指标 + 四态（§21.3）+ anti-cheat v0（hidden DOM suspicious / 空标记 weak）、id-space 对齐 normalizedPath、CoverageReport JSON 落盘、goal-loop 三指标摘要 stdout、`runs.terminated_by` 审计。

- demo 闭环：`pnpm demo:codegen` 一键跑 `demo:openapi` → `nx-mk run` → codegen → `app/src/generated-sdk.ts`。存量代码迁移：`npx nx-mk migrate`（静态 fetch 替换）+ `patchGlobalFetch()`（兜底）。
- Phase 2 采集闭环：`nx-mk run` 驱动 headless chromium 扫 demo 前端 → field_hits / ui_evidence / request_traces 三表落库。
- Phase 3 goal 闭环（手动验收，见下）：config `goal:` 段 + `coverage:` 段 → CLI `run` 驱动 Goal Loop → 期望 events.jsonl `goal:met` + `runs.terminated_by='goal-met'` + `coverage-report.json` 三指标互证。

完整方案见 [`docx/plan/nx-mk-plan.md`](./docx/plan/nx-mk-plan.md)。
本阶段 spec：Phase 2 [`docs/superpowers/specs/2026-09-16-nx-mk-phase2-collection-design.md`](./docs/superpowers/specs/2026-09-16-nx-mk-phase2-collection-design.md)，Phase 3 [`docs/superpowers/specs/2026-09-17-nx-mk-phase3-analysis-design.md`](./docs/superpowers/specs/2026-09-17-nx-mk-phase3-analysis-design.md)。

### Phase 3 手动验收步骤（goal 闭环 + coverage 报告三点互证）

> 环境要求：chromium 可执行（未装 → `npx playwright install chromium`）。
> ⚠️ env 变量纠错：`MK_ANALYSIS=true` 给 **vite 进程**（define 在 dev server 启动时
> 烘焙 `__MK_ANALYSIS__`，重启生效），不是给 CLI 进程；CLI `run` 本体不做 fetch。

```bash
# 0. 按依赖顺序构建（无 turbo）：client → coverage → kernel → config → plugin-playwright → cli
corepack pnpm --filter @nx-mk/client build && corepack pnpm --filter @nx-mk/coverage build \
  && corepack pnpm --filter @nx-mk/kernel build && corepack pnpm --filter @nx-mk/config build \
  && corepack pnpm --filter @nx-mk/plugin-playwright build && corepack pnpm --filter @nx-mk/cli build

# 1. 重新生成 demo manifest（config.goal 与 coverage 已配置后）
corepack pnpm demo:openapi

# 2. 起后端（8787）
corepack pnpm --filter @nx-mk-example/server dev &

# 3. 起前端（5173，MK_ANALYSIS=true 烘焙 analysis mode —— Ruling 6 缺省解析）
MK_ANALYSIS=true corepack pnpm --filter @nx-mk-example/app dev &

# 4. 起采集 run（demo 目录内，config.goal 已配 → Goal Loop 启用）
cd examples/react-vite-demo
node ../../packages/cli/dist/index.js run

# 5. 验收断言（spec §1.4.1 / §3.6，三点互证）：
# ① stdout：Coverage 三行 + goal:met
#   期望输出：Coverage: required 100% | effective 100% | raw backend 视页面读取比例（demo 约 36%）
#             missing required: 0 | ignored returned: 0 | suspicious: 0
# ② events.jsonl 尾部 goal:met 事件
grep '"type":"goal:met"' .nx-mk/runs/*/events.jsonl
# ③ runs.terminated_by = 'goal-met'
sqlite3 .nx-mk/coverage.db "SELECT terminated_by FROM runs ORDER BY started_at DESC LIMIT 1"
# ④ coverage-report.json 存在且 requiredCoverage === 1
cat .nx-mk/coverage-report.json | jq '.metrics.requiredCoverage'
```

期望：单次收集通路后 Goal Loop goal-met 终止（field_hits / ui_evidence / request_traces
三表落库，`runs.terminated_by='goal-met'`，`coverage-report.json` 三指标中
`requiredCoverage=1`、`ignoredReturnedFields=0`（internalRiskScore 未被页面读取，
无 accessHit 故不进 ignored-returned 集合），`missingRequiredFields=0`）。
实际 demo manifest 有 22 个 response 字段、页面只读 /users/{id} 相关字段（约 8/22），
故 rawBackendFieldCoverage≈36%；`coverage.ignored` 因此实配 7 条（校准产物），
spec §3.6 字面示例 `['**.metadata.**','data.internalRiskScore']` 仅为示意。
未先起 vite/后端 → fail-fast（spec §4）。
若 goal 未达成：用 events.jsonl turn 事件与 coverage-report.json missing 列表定位
未命中字段，回 `nx-mk.config.yml` 修正 `coverage.ignored` 或修正 `UserProfile.tsx` Field
值后重跑（校准回路，允许 2-3 轮）。

已知限制（v0 接受，后续版本修）：
- endpointId 落 'unknown' fallback（manifest 未注浏览器，Ruling 8 见
  `packages/plugin-playwright/src/index.ts` 头注释）。
- shim 按文档重放：整页导航会重置 `window.__MK_COLLECTOR__` 缓冲，未回捞的
  hits/traces 即丢（addInitScript per-document 语义）；demo 无整页导航，v0 接受。
- cross-document shim 跨导航持久化：sessionStorage / 常态回捞方案（Phase 4+）。

## Dashboard（Phase 4）

```bash
cd examples/react-vite-demo
node ../../packages/cli/dist/index.js start
```

- 默认 `http://127.0.0.1:4317`（`--port` 覆盖；config `dashboard.port` / `dashboard.open` 可配）
- 先起 server 再自动跑一次分析（`--no-run` 只看已有产物）；run 失败 server 不关，failed run 可见
- 页面：Overview（最新 run 三指标）/ Runs / run 总览 / Requests 列表+详情（含 field hits 与 UI evidence 文本样本）/ Fields 四态列表 / Returned-but-ignored
- 数据全部只读自 `.nx-mk/`（coverage.db readonly + coverage-report.json + runs 目录）；UI 每 5 秒轮询，运行中的 run 完成后数据自动出现

## 开发

```bash
pnpm install
pnpm build
pnpm test
```

## 包结构

```
packages/
├── kernel/                # @mk/kernel — 微内核（插件 + 事件 + 生命周期）
├── config/                # @mk/config — 配置 schema + loader
├── manifest/              # @mk/manifest — OpenAPI → Manifest（占位）
├── cli/                   # @mk/cli — npx mk 入口（占位）
└── plugin-swagger/        # @mk/plugin-swagger — OpenAPI 适配插件（占位）
```