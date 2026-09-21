# nx-mk

> OpenAPI-driven frontend API/UI coverage analyzer with SDK Facade

通过 `npx nx-mk` 一键启动本地分析工作台：解析 OpenAPI → 生成 Manifest → 注入 SDK Facade → 采集 request/field-hit/UI-evidence → policy 判定 + coverage 分析 → 写报告 + goal 驱动终止。

## 当前状态

**Phase 0-5 全部完成** —— 含 Phase 1.5（SDK Facade Codegen）、Phase 4.5（Dashboard 可操作化）、v1（插件配置写回链）。
测试基线：**77 文件 / 588 测试全绿**，`pnpm -r typecheck` 14 包零报错。

已完成能力一览：

- **Phase 3 分析**：policy-engine 全量（§21 优先级 + glob `*`/`**`/字面）、coverage analyzer §28 + 三指标 + 四态（§21.3）+ anti-cheat v0（hidden DOM suspicious / 空标记 weak）、id-space 对齐 normalizedPath、CoverageReport JSON 落盘、goal-loop 三指标摘要 stdout、`runs.terminated_by` 审计。
- **Phase 2 采集闭环**：`nx-mk run` 驱动 headless chromium 扫 demo 前端 → field_hits / ui_evidence / request_traces 三表落库。
- **Phase 3 goal 闭环**（手动验收，见下）：config `goal:` 段 + `coverage:` 段 → CLI `run` 驱动 Goal Loop → 期望 events.jsonl `goal:met` + `runs.terminated_by='goal-met'` + `coverage-report.json` 三指标互证。
- **demo 闭环**：`pnpm demo:codegen` 一键跑 `demo:openapi` → `nx-mk run` → codegen → `app/src/generated-sdk.ts`。存量代码迁移：`nx-mk migrate`（静态 fetch 替换）+ `patchGlobalFetch()`（兜底）。

**进行中：§26 Scenario DSL 运行器 + Replay Scenario** —— spec 已合入
（[`2026-09-21-nx-mk-scenario-dsl-replay-design.md`](./docs/superpowers/specs/2026-09-21-nx-mk-scenario-dsl-replay-design.md)），
实现未开始。范围为：新包 `@nx-mk/scenario`（dsl-schema / dsl-loader / runner / playwright-runner / scenario-replay）、
config `scenarios:` 段、`nx-mk run` 套件执行模式、dashboard `GET /api/scenarios` + 单场景回放 + `/scenarios` 页。

完整方案见 [`docx/plan/nx-mk-plan.md`](./docx/plan/nx-mk-plan.md)（§编号是各期 spec 的引用锚点）；
各期 SDD 产物在 [`docs/superpowers/specs/`](./docs/superpowers/specs/) 与 [`docs/superpowers/plans/`](./docs/superpowers/plans/)；
非阻塞遗留项台账 [`docs/hygiene-backlog.md`](./docs/hygiene-backlog.md)（15 项全部已修，2026-09-19 清零）。

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

## Agent Loop（Phase 5，实验）

`nx-mk loop` 读取最新 `.nx-mk/coverage-report.json`，把 missing required 字段分批交给本地 `claude` CLI 产出 unified diff，经静态 review guard 后落 `.nx-mk/patches/`。全程不写工作区文件（suggest-diff 模式）：

```bash
nx-mk run          # 先产出 coverage report
nx-mk loop         # 产 diff → .nx-mk/patches/<agentRunId>/
git apply .nx-mk/patches/<agentRunId>/*.patch
nx-mk run          # 验证 requiredCoverage 真实提升
```

前置：本地已安装并登录 `claude` CLI（loop 只授 Read/Grep/Glob 只读工具，agent 无写文件通道）。可选配置（provider 超时 / 轮数 / 批次）见 demo `nx-mk.config.yml` 尾部注释。注意：含 `/` 的字段 id 生成的补丁文件名可能带子目录，shell 通配用 `find .nx-mk/patches/<id> -name '*.patch'` 更稳。

## Phase 4.5：Dashboard 可操作化（手动验收）

```bash
# 0. 全量构建（含 @nx-mk/agent —— 不构建则 CLI loop 测试/运行缺依赖）
#    ⚠️ `pnpm -r build` 从干净状态会卡在 config 包，先单独构建 kernel，见「开发」节
corepack pnpm install --frozen-lockfile && corepack pnpm -r build

# 1. 起分析 + Dashboard（demo 目录内）
npx nx-mk start

# 2. 浏览器验收清单：
#    a. 请求详情页 → [Replay request]：safe GET 直接复刻 + .nx-mk/replays/<runId>/ 留痕；
#    b. 构造 POST trace → 无 confirm 409 → Confirm replay 后成功（留痕 verdict=unsafe）；
#    c. curl -N "http://127.0.0.1:4317/api/events" → run 进行时看到 stage:start/stage:done/agent:iteration；
#    d. #/runs/<runId>/manifest → endpoints 表 + schema 字段表 + policy 徽章；
#    e. #/settings/plugins → 内置插件卡片 + Copy YAML。
```

## v1：插件配置写回链（已合入）

`nx-mk.config.yml` 的 `plugins:` 条目从 `string[]` 扩为联合类型（裸 string 等价于 `config: {}`），旧格式配置完全兼容。dashboard `/settings/plugins` 可就地编辑任一插件的 config，走两段式写回：

```bash
# ① 预览 diff（dryRun 缺省 true —— 不落盘；响应回传 yamlSha）
curl -X PATCH "http://127.0.0.1:4317/api/plugins/plugin-playwright/config" \
  -H 'content-type: application/json' -d '{"config":{...}}'
# ② 落盘（显式 dryRun=false + 带上一步的 yamlSha；写前留单代 .bak，sha 失配 → 409）
curl -X PATCH "http://127.0.0.1:4317/api/plugins/plugin-playwright/config?dryRun=false" \
  -H 'content-type: application/json' -d '{"config":{...},"yamlSha":"<上一步返回>"}'
```

- 写回引擎在 `@nx-mk/config` 的 `writeback.ts`：yaml Document API round-trip **保注释** + tmp+rename 原子写 + 单代 `.bak` + sha 并发防护
- 铁律：dashboard server 的 fs 写路径白名单仍恰 1 个文件（`server/replay.ts`）——`nx-mk.config.yml` 的唯一写者在 config 包
- 改动下次 `nx-mk run` 生效；configSchema 的深度校验在 kernel 侧 fail-fast（`PLUGIN_CONFIG_INVALID`）

## 开发

```bash
pnpm install
pnpm build
pnpm test
```

**⚠️ 构建顺序注意**：`@nx-mk/config` 与 `@nx-mk/kernel` 互为 workspace 依赖（config 的 peerDep / kernel 的 devDep），
pnpm 的拓扑排序会把 config 排在 kernel 之前，导致 config 的 dts 读不到 kernel 的类型声明（报 `Config.plugins` 类型不匹配）。
首次或全量构建**先单独构建 kernel，再跑全量**：

```bash
cd packages/kernel && node ../../node_modules/tsup/dist/cli-default.js && cd ../..
pnpm -r --workspace-concurrency=1 build
```

## 包结构

12 个包，全部 `@nx-mk/*` scope（业务集成契约 `@mk/client` 见 [方案 §5.3](./docx/plan/nx-mk-plan.md)）。

```
packages/
├── kernel/                # @nx-mk/kernel — 微内核：插件生命周期 + 事件总线 + Goal Loop
├── schema/                # @nx-mk/schema — standard-schema 适配器（插件 config 校验）
├── config/                # @nx-mk/config — 配置 schema + YAML loader + 写回引擎（writeback.ts）
├── manifest-schema/       # @nx-mk/manifest-schema — Manifest 定义：共享类型 + schema 工具（fieldId/normalizer）
├── manifest/              # @nx-mk/manifest — OpenAPI → Manifest（Provider 角色）
├── client/                # @nx-mk/client — SDK Facade：runtime proxy/collector + Codegen + migrate + patch
├── coverage/              # @nx-mk/coverage — 覆盖率存储：§25 DDL + traces/evidence 落库 + analyzer + policy-engine
├── plugin-swagger/        # @nx-mk/plugin-swagger — OpenAPI 解析插件（写 .nx-mk/manifest.json）
├── plugin-playwright/     # @nx-mk/plugin-playwright — headless chromium 采集 + DOM 扫描 + Goal 收敛
├── dashboard/             # @nx-mk/dashboard — 本地只读覆盖台（fastify server + React UI）
├── agent/                 # @nx-mk/agent — Agent Loop（claude-code provider / review guard / suggest-diff 落盘）
└── cli/                   # @nx-mk/cli — npx nx-mk 入口（init / doctor / run / start / loop / migrate）
```

每个包都有独立 README，说明其职责、导出面与关键语义：

[`kernel`](./packages/kernel/README.md) · [`schema`](./packages/schema/README.md) ·
[`config`](./packages/config/README.md) · [`manifest-schema`](./packages/manifest-schema/README.md) ·
[`manifest`](./packages/manifest/README.md) · [`client`](./packages/client/README.md) ·
[`coverage`](./packages/coverage/README.md) · [`plugin-swagger`](./packages/plugin-swagger/README.md) ·
[`plugin-playwright`](./packages/plugin-playwright/README.md) · [`dashboard`](./packages/dashboard/README.md) ·
[`agent`](./packages/agent/README.md) · [`cli`](./packages/cli/README.md)
