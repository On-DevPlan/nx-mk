# nx-mk Spec: Phase 5 — Agent Loop v0（agent-sdk / claude-code provider / suggest diff / review guard）

> 日期：2026-09-18
> 范围：Phase 5 — 覆盖率缺口 → AI 修复 diff 的最小闭环（suggest-diff 模式，全程零工作区写入）
> 不在范围：workspace-write / auto-apply（D1 禁区）、api-client-agent / dsl-agent / policy-agent、command / http provider（I 段后置）、临时副本 verify 与 rollback、Dashboard 变更、loop 内重跑 run、Watch（§39）、CI（§40）
> 关联文档：
> - `docx/plan/nx-mk-plan.md`（§32 Agent 设计、§33 Agent SDK、§34 Agent Provider、§35 内置插件、§36 权限模型、§37 Agent Loop、§38 终止与回滚、§41.1 MVP、§42 Phase 5 roadmap、§44.4 不直接追求 100%）
> - `docs/superpowers/specs/2026-09-17-nx-mk-phase3-analysis-design.md`（CoverageReport —— 本期唯一数据输入）
> - `docs/superpowers/specs/2026-09-17-nx-mk-phase4-dashboard-design.md`（runs 目录布局与只读铁律的出处；本期不触碰 dashboard 代码）

---

## 1. 目标与范围

### 1.1 一句话

`nx-mk loop` 读取最新 coverage report，把 missing required 字段分批交给 claude 产 unified diff，经静态 review guard 把关后落 `.nx-mk/patches/`，全程不写工作区文件；用户手动 `git apply` 后重跑 `nx-mk run` 验证真实提升。

### 1.2 目标清单（7 条）

1. **新包 `@nx-mk/agent`**：agent-sdk 协议（`defineCoverageAgent` + `CoverageAgentPlugin`，§33 对齐收缩）+ Agent Runtime（批次规划 / 轮次循环 / 终止判定 / 审计）+ claude-code provider + 内置 `api-ui-agent` / `review-agent`
2. **`nx-mk loop` 子命令**（plan §9 预定名「运行 Agent Loop」）：消费 `.nx-mk/coverage-report.json` → N 轮「plan → 产 diff → review guard → 落盘落库」→ stdout 轮次摘要
3. **suggest-diff 铁律（plan D1）**：全链路零工作区写入——claude 子进程只授只读工具集；diff 只落 `.nx-mk/patches/<agentRunId>/`；可应用性验证用 `git apply --check`（不落盘）
4. **review guard（review-agent）**：v0 为**纯静态规则引擎，不调 AI**——`git apply --check` + anti-cheat 静态启发式（ignored-render / JSON.stringify dump / console.log 探针）
5. **`agent_iterations` 审计落库**：复用 `@nx-mk/coverage` 既有 `openCoverageDb`（§25.9 DDL 已逐字存在）；agent 自建 run 目录，不污染历史 run
6. **config `agent:` 段**（provider + loop 两小节）+ cli/config/kernel 三处接线 + 退出码扩展
7. **注入式可测**：`runAgentLoop` 接受 provider/agent 注入（对齐 Phase 4 `StartDeps` 模式），scripted fake 驱动全部 loop 集成测试；真 claude 调用不进 CI

### 1.3 非目标

- workspace-write / auto-apply / rollback（plan D1 + §36：MVP 默认 suggest-diff，用户手动 apply）
- api-client-agent / dsl-agent（依赖未建的 §26/§27 DSL/Replay）、policy-agent（后补，协议已容纳）
- provider `generate` / `review` 通道（§34 收缩，见附注 A）
- `rollbackOnRegression` 配置项（§38 收缩：无写盘即无回退，收了误导，见附注 A）
- Dashboard 任何变更（agent run 会自然出现在既有 runs 列表，无需改码——见 §3.7）
- loop 内重跑 run（R2：diff 未 apply，重跑无信息量；apply 后由用户手动重跑）
- Watch 模式（§39）、CI 模式（§40，E1/E2 已移出 MVP）

---

## 2. 决策记录

### 2.1 继承自 plan 的硬决策

| # | 决策 | 出处 |
|---|---|---|
| D1 | MVP Agent 只产出 diff，用户手动 apply；不实现 workspace-write / auto-apply | plan §36/§41.1 |
| D2 | provider 仅 claude-code 一个；command / http adapter 后置 | plan §42/§6 备注 |
| D3 | Agent 不直接追求 100%：尊重 policy、不碰 ignored、不产垃圾 UI | plan §44.4 |

### 2.2 本期用户裁定（2026-09-18 四问四答）

| # | 问题 | 裁定 |
|---|---|---|
| U1 | provider 实现路径 | **spawn 本地 `claude` CLI**（复用现有登录与网络配置，零新凭据零新依赖）；Provider 接口保持 §34 形状，将来换 Agent SDK 只动 adapter 内部 |
| U2 | 内置 Agent 范围 | **api-ui-agent + review-agent** 两个；policy-agent 若顺带成本低再议（不承诺）；api-client/dsl 排除 |
| U3 | loop v0 语义（D1 下 §37 与 apply/verify/rollback 冲突） | **轮次产 diff 集，不验证**：每轮基于同一 report 产一批 diff → 静态审查 → 落盘落库；verify = review guard（静态）；rollback 不适用；用户手动 apply 后重跑 run |
| U4 | 产出与审计面 | **CLI 摘要 + 补丁文件 + agent_iterations 落库**；Dashboard 本期不动，agent 页面进 backlog |

### 2.3 本期设计裁定（spec 级，plan 必须遵守）

| # | 裁定 | 理由 / 代价 |
|---|---|---|
| R1 | provider = `spawn('claude', ['-p', prompt, '--output-format', 'json', '--allowedTools', 'Read,Grep,Glob', ...])`，cwd=项目根 | 只读工具集让 claude 能读真实源码产准确 diff，同时 D1 在子进程内部也成立（无 Edit/Write 权限）。代价：diff 行号准确性依赖模型，由 `git apply --check` 兜底把关 |
| R2 | loop 输入固定为执行时刻 `.nx-mk/coverage-report.json`；轮内不重跑 run | diff 未 apply 时重跑结果相同，纯浪费。代价：报告过时由用户负责（摘要提示 report 的 runId） |
| R3 | `agent_iterations.after_coverage` 一律 NULL | 未测量不造假。`before_coverage` 写 loop 起点 `metrics.requiredCoverage` |
| R4 | agent 每次执行自建 run 目录（`.nx-mk/runs/<agentRunId>/`），经 `openCoverageDb` 建 9 表 + 写 `runs` 行（status='agent-loop'） | 审计归属清晰；副作用：agent run 自然出现在 dashboard runs 列表（hasEvents=false, hasReport=false），无需改 dashboard |
| R5 | review guard 的 JSON.stringify-dump / console.log 探针做**静态文本级**正则启发式 | 与 Phase 3 排除的「运行时探针版」不冲突——guard 面对的是 diff 文本，本来就可静态判。代价：启发式有漏报误报，v0 接受 |
| R6 | **每字段跨轮唯一尝试**：一个 fieldId 在一次 loop 执行内至多产出一个 accepted diff；rejected/failed 的字段在后续轮重试一次，再败即放弃（'given-up'） | 防止固定 report 下轮次空转与重复 diff |
| R7 | **轮次 = 批次**：每轮从 missingRequiredFields 待办中取 `maxTasksPerIteration`（默认 5）个字段 | 使多轮循环在 D1（report 固定）下有真实语义：循环即分批推进 + 提前放弃机制 |
| R8 | AgentContext.manifestSummary / policySummary **由 CoverageReport 派生**（endpoints + 字段清单 + policy 状态渲染为文本），不直接读 manifest.json | 少一条文件路径依赖；报告已是 policy 过滤后的完备视图 |
| R9 | diff **不解析**：从模型输出提取 fenced ```diff 块（兜底：全文含 `diff --git` 时取全文），原样落盘；可应用性全部交给 `git apply --check` | 解析器为零，git 是唯一的 truth。代价：无法按文件拆分 diff，一 task 一个 .patch |
| R10 | 项目根不在 git 仓库内时，`git apply --check` 记 'skipped'，verdict 仅由静态规则决定 | 演示/临时目录场景不炸 |

---

## 3. 架构

### 3.1 三层实例化（plan §32 → 本期）

```
Agent Runtime        packages/agent/src/runtime.ts（系统原生：批次/轮次/终止/审计）
Agent Provider       packages/agent/src/provider/claude-code.ts（本期唯一；接口 §34 收缩版）
Agent Plugin         packages/agent/src/agents/{api-ui,review}.ts（内置两个；协议 §33）
```

### 3.2 数据流

```
.nx-mk/coverage-report.json（最新 run，已过 policy-engine）
      │  读入 + 轻量形状门（runId + metrics 三指标存在）
      ▼
runAgentLoop（agentRunId = makeRunId('agent')）
  建 .nx-mk/runs/<agentRunId>/ + openCoverageDb + runs 行(status='agent-loop')
      │  每 iteration ≤ maxIterations:
      │   1. api-ui-agent.plan(ctx)   → 待办批次（R6/R7：跨轮唯一尝试 + 每轮 maxTasksPerIteration）
      │   2. 逐 task: api-ui-agent.apply → provider.edit（spawn claude，只读工具集）
      │   3. 提取 diff 文本（R9）→ review-agent 静态审查（§3.6）
      │   4. verdict=pass → .nx-mk/patches/<agentRunId>/iter-N-<fieldSlug>.patch
      │   5. agent_iterations 行（逐 task 一行：produced / rejected / failed / given-up）
      │   6. 终止判定：待办空 ‖ maxIterations ‖ 连续 stopIfNoImprovementRounds 轮零 produced
      ▼
stdout 摘要（英文）：轮次统计 + patches 目录 + 下一步指引
  "git apply .nx-mk/patches/<id>/*.patch && nx-mk run"
```

### 3.3 包结构

```
packages/agent/
  package.json            # deps: @nx-mk/kernel, @nx-mk/coverage, better-sqlite3(对齐 coverage 版本)
  tsup.config.ts          # entry src/index.ts → dist/（对齐 coverage 惯例）
  src/
    index.ts              # 出口：defineCoverageAgent + 全部协议类型 + runAgentLoop
    types.ts              # §3.4 协议类型（唯一事实源）
    runtime.ts            # runAgentLoop 编排（批次/轮次/终止/审计/摘要）
    patches.ts            # diff 提取 + 落盘 + gitApplyCheck 封装
    provider/
      claude-code.ts      # spawnAgentClaude：spawn + stdout JSON 解析 + 超时 + ENOENT 映射
    agents/
      api-ui.ts           # api-ui-agent：plan（批次切片）+ apply（prompt 组装）
      review.ts           # review-agent：静态 guard（applyCheck + 3 条启发式）
    __tests__/            # 扁平测试布局（对齐 dashboard 包）
      claude-provider.test.ts / patches.test.ts / review.test.ts /
      api-ui.test.ts / runtime-loop.test.ts / runtime-terminate.test.ts
```

CLI/接线侧改动（既有文件）：

```
packages/cli/src/commands/loop.ts        # loopMain + LoopDeps 注入缝（对齐 start.ts）
packages/cli/src/__tests__/loop.test.ts  # CLI 接线测试（注入 LoopDeps 替身，对齐 start 测试模式）
packages/cli/src/index.ts                # loop 子命令接线四件套（对齐 Phase 4 start）
packages/config/src/schema.ts            # AgentConfigSchema + ConfigSchema.agent
packages/config/src/loader.ts            # subcommand 联合 + 'loop'
packages/kernel/src/types.ts             # ResolvedConfig.subcommand + 'loop'
packages/kernel/src/errors.ts            # +RUN_NOT_FOUND、+PROVIDER_UNAVAILABLE（§4）
```

### 3.4 核心接口（plan 任务逐字转写的唯一事实源）

```ts
// ---- types.ts ----

// 任务：v0 只有 render-field 一种；字段级 diff 粒度
export interface AgentTask {
  type: 'render-field'
  fieldId: string          // FieldCoverageItem.fieldId
  fieldPath: string
  endpointId: string | null // FieldCoverageItem.endpointId ?? null
  reason: string           // missing / weak-evidence 等人读理由
}

export interface AgentPlan { tasks: AgentTask[] }

// 逐 task 的 apply 结果：diff 文本或失败原因（不抛异常，错误即结果）
export interface TaskApplyResult {
  task: AgentTask
  status: 'diff-produced' | 'failed'
  diffText?: string        // status=diff-produced 时存在
  error?: string           // status=failed 时的人读原因
}

export interface AgentApplyResult { results: TaskApplyResult[] }

// review verdict：静态 guard 的产出
export interface AgentVerifyResult {
  verdict: 'pass' | 'reject'
  checks: { name: string; outcome: 'pass' | 'reject' | 'skipped'; detail?: string }[]
}

// §33 收缩版上下文（附注 A 列差异）
export interface AgentContext {
  report: CoverageReport      // 只读输入（@nx-mk/coverage 类型）
  manifestSummary: string     // R8：由 report 派生的文本
  policySummary: string       // R8
  projectRoot: string         // nx-mk.config.yml 所在目录（claude cwd / git apply cwd）
  ai: AgentProvider
  log: (msg: string) => void
}

// §33 逐字形状（capabilities 收为 string 别名；verify 可选）
export interface CoverageAgentPlugin {
  name: string
  version: string
  capabilities: string[]
  plan(ctx: AgentContext): Promise<AgentPlan>
  apply(ctx: AgentContext, plan: AgentPlan): Promise<AgentApplyResult>
  verify?(ctx: AgentContext, result: AgentApplyResult): Promise<AgentVerifyResult>
}

// SDK 入口：恒等函数（类型收口用，与内核 definePlugin 同风格）
export function defineCoverageAgent(plugin: CoverageAgentPlugin): CoverageAgentPlugin

// §34 收缩版：v0 仅 edit 通道（附注 A）
export interface AgentEditInput {
  instructions: string
  context?: Record<string, unknown>   // 渲染进 prompt 的结构化上下文
}
export interface AgentEditOutput { diffText: string }
export interface AgentProvider {
  name: string
  edit(input: AgentEditInput): Promise<AgentEditOutput>
}

// runtime 入口（LoopDeps 为注入缝，测试用 scripted fake；
// 注意：claude adapter 在 CLI 装配层构造为 provider 注入，runtime 不感知 spawn 细节）
export interface LoopDeps {
  provider: AgentProvider
  apiUiAgent: CoverageAgentPlugin
  reviewAgent: CoverageAgentPlugin    // 其 verify() 即 guard
}
export interface LoopOptions {
  projectRoot: string
  report: CoverageReport
  config: AgentConfig                 // kernel 镜像类型；原始可选段，默认值由 runtime 回填
  log?: (msg: string) => void
}
export interface LoopSummary {
  agentRunId: string
  iterations: number
  produced: number
  rejected: number
  failed: number
  givenUp: number
  patchDir: string                    // 相对 projectRoot
  stoppedBy: 'backlog-empty' | 'max-iterations' | 'no-improvement'
}
export function runAgentLoop(opts: LoopOptions, deps: LoopDeps): Promise<LoopSummary>
```

### 3.5 claude-code provider 协议

```
spawn('claude', [
  '-p', <组装后的完整 prompt>,
  '--output-format', 'json',
  '--allowedTools', 'Read Grep Glob',      # 只读三件套：可读源码产准确 diff，无写能力（D1 双保险）
  '--max-turns', String(config.provider.maxTurns),
], { cwd: projectRoot })
```

- prompt 组装（api-ui-agent.apply）：§44.4 约束指令（不 render ignored 字段 / 不 JSON.stringify dump / 不 console.log 探针 / 产出可见 UI evidence 所需的 `data-mk-field` 标注）+ task 字段上下文（endpoint / fieldPath / reason）+ manifestSummary + 「只输出一个 fenced ```diff 块，unified diff 格式」
- stdout 解析：`--output-format json` 单对象 → `JSON.parse` 后取 `result` 字符串 → R9 提取 diff；`is_error: true` 或 stderr 非空且无 result → task failed
- 超时：`config.provider.timeoutMs`（默认 300_000），超时 kill 子进程 → task failed
- spawn ENOENT → 抛 `KernelError('PROVIDER_UNAVAILABLE')`（进程级，非 task 级——CLI 没装 claude 时整条 loop 无意义）
- 测试：spawn 函数注入替换；真实子进程不进 CI

### 3.6 review guard 静态规则（review-agent.verify）

| # | 检查 | 判 reject 条件 | 说明 |
|---|---|---|---|
| G1 | apply-check | `git apply --check <patch>` 非零退出 | cwd=projectRoot；非 git 仓库 → 'skipped'（R10） |
| G2 | ignored-render | 新增行含 `data-mk-field` / `mk-field` 指向 **ignored** 字段 id（从 report.ignoredReturnedFields 取 id 集合比对） | D3：不碰 ignored |
| G3 | json-dump | 新增行含 `JSON.stringify(` 且同行/邻近行含 response/`res.`/`data` 上下文特征（正则启发式） | R5；Phase 3 运行时探针版的静态替身 |
| G4 | console-probe | 新增行含 `console.log(` 且含 field/coverage 字样 | R5 |

- 全部输入为 diff 文本新增行（`+` 开头、非 `+++`）；任一 reject 即该 diff 不落 patches 目录（但 agent_iterations 仍记 'rejected' + diff_path 留档于 `patches/<id>/rejected/`）
- 不调 AI（纯确定性，可穷举测试）

### 3.7 落盘与落库布局

```
.nx-mk/
  coverage-report.json              # 既有，loop 只读
  runs/<agentRunId>/                # R4：agent 自建 run 目录
    coverage.db                     # openCoverageDb 建 9 表；runs 行 status='agent-loop'
                                    # agent_iterations 逐 task 一行：
                                    #   id=ai_<agentRunId>_<iter>_<taskIdx>
                                    #   run_id=<agentRunId>  iteration=<N>
                                    #   status='produced'|'rejected'|'failed'|'given-up'
                                    #   summary=<task.reason 短文>
                                    #   before_coverage=<起点 requiredCoverage>
                                    #   after_coverage=NULL（R3）
                                    #   diff_path=<patches 相对路径|NULL>
    （无 events.jsonl / kernel.log —— dashboard hasEvents=false 兼容）
  patches/<agentRunId>/
    iter-<N>-<fieldSlug>.patch      # verdict=pass 的 diff
    rejected/iter-<N>-<fieldSlug>.patch   # reject 留档（不参与 git apply 清单）
```

- `fieldSlug` 消毒规则：fieldId 中 `[a-zA-Z0-9._/-]` 以外字符替换为 `_`，超 40 字符截断

- `diff_path` 落相对 projectRoot 的 posix 风格路径（`.nx-mk/patches/...`）
- agent run 出现在既有 dashboard `/api/runs` 列表是**预期行为**（R4），dashboard 代码零改动

### 3.8 config `agent:` 段

```yaml
agent:
  provider:
    type: claude-code        # 唯一合法值（D2）；其他值 CONFIG_INVALID
    timeoutMs: 300000        # 可选，单次 edit 超时
    maxTurns: 8              # 可选，claude -p --max-turns
  loop:
    maxIterations: 5             # plan §38 逐字默认
    stopIfNoImprovementRounds: 2 # plan §38 逐字默认
    maxTasksPerIteration: 5      # 新增：R7 批次大小
```

```ts
// schema.ts 追加（对齐 DashboardConfigSchema 风格，全部 optional + 默认值回填在 runtime）
export const AgentProviderConfigSchema = z.object({
  type: z.literal('claude-code'),
  timeoutMs: z.number().int().positive().optional(),
  maxTurns: z.number().int().positive().optional(),
})
export const AgentLoopConfigSchema = z.object({
  maxIterations: z.number().int().positive().optional(),
  stopIfNoImprovementRounds: z.number().int().positive().optional(),
  maxTasksPerIteration: z.number().int().positive().optional(),
})
export const AgentConfigSchema = z.object({
  provider: AgentProviderConfigSchema.optional(),
  loop: AgentLoopConfigSchema.optional(),
})
// ConfigSchema + agent: AgentConfigSchema.optional()
// kernel types.ts + AgentConfig 镜像类型 + ResolvedConfig.subcommand + 'loop'
// loader.ts subcommand 联合 + 'loop'
// runtime 默认值：timeoutMs=300_000, maxTurns=8, maxIterations=5,
//                stopIfNoImprovementRounds=2, maxTasksPerIteration=5
```

- §38 `rollbackOnRegression` **不收**（无写盘无回退，见附注 A）

### 3.9 CLI `nx-mk loop`

```
用法：nx-mk loop [--max-iterations N]
```

流程（loopMain，LoopDeps 注入缝）：

1. findConfigFile / loadConfig（subcommand 'loop'）——缺配置 → CONFIG_NOT_FOUND（复用 Phase 4 start 的 existsSync 前置检查语义）
2. 读 `.nx-mk/coverage-report.json` → 缺失或形状门不过 → `RUN_NOT_FOUND`，消息指引先跑 `nx-mk run`
3. runAgentLoop（§3.2）
4. stdout 摘要（英文，对齐既有 CLI 输出语言）：

```
Agent loop completed: agent_20260918_... 
  iterations: 2  produced: 5  rejected: 1  failed: 1  given-up: 0  (stopped by: backlog-empty)
  report runId: run_xxx (requiredCoverage 62.5%)
  patches: .nx-mk/patches/agent_20260918_.../
  next: git apply .nx-mk/patches/agent_20260918_.../*.patch && nx-mk run
```

- 接线四件套对齐 Phase 4 start：`cli/src/index.ts`（Subcommand 联合 + ParsedArgs.loop{maxIterations?} + `--max-iterations` case + HELP 行 + main case）、`config/loader.ts` subcommand + 'loop'、`kernel/types.ts` ResolvedConfig.subcommand + 'loop'
- 退出码：正常完成（含含 rejected/failed 的部分成功）→ 0；RUN_NOT_FOUND / PROVIDER_UNAVAILABLE → 2；其余按既有映射

---

## 4. 错误处理表

| # | 场景 | 行为 | 错误码 / 退出码 |
|---|---|---|---|
| E1 | `.nx-mk/coverage-report.json` 缺失或形状门不过 | 进程报错退出，消息指引先 `nx-mk run` | RUN_NOT_FOUND → 2 |
| E2 | 配置文件缺失 | 前置 existsSync 检查（对齐 start） | CONFIG_NOT_FOUND → 2 |
| E3 | config `agent.provider.type` ≠ claude-code | 校验失败 | CONFIG_INVALID → 2 |
| E4 | claude CLI 未安装（spawn ENOENT） | 进程报错退出，消息指路安装/登录 | PROVIDER_UNAVAILABLE → 2 |
| E5 | claude 非零退出 / 超时 / stdout 无 result / is_error | 该 task 记 failed（error 带原因），继续其余 task | 无退出（task 级） |
| E6 | diff 提取为空（无 fenced 块且无 `diff --git`） | 该 task 记 failed | 无退出（task 级） |
| E7 | `git apply --check` 非零 | G1 reject；diff 留档 rejected/ | 无退出（task 级） |
| E8 | 项目根非 git 仓库 | G1 记 skipped，verdict 由 G2-G4 决定（R10） | 无退出 |
| E9 | patches / run 目录写失败 | 进程报错退出 | KERNEL_INTERNAL → 5 |
| E10 | coverage.db 写入 busy/失败 | 进程报错退出（agent 写自建新库，无读者竞争） | KERNEL_INTERNAL → 5 |

退出码映射扩展（errors.ts，纯增量）：

```ts
| 'RUN_NOT_FOUND'          // → 2（运行前置产物缺失，用户可自修）
| 'PROVIDER_UNAVAILABLE'   // → 2（外部依赖缺失，用户可自修）
// 注释行同步扩展：2=配置/运行前置错误
```

---

## 5. 测试策略

| 层 | 测试 | 要点 |
|---|---|---|
| provider | claude-provider.test.ts | 注入 spawn 替身：参数快照（`--allowedTools` 只读集 / cwd / `--max-turns`）；stdout JSON 各态（正常 result / is_error / 非 JSON / ENOENT→PROVIDER_UNAVAILABLE / 超时 kill） |
| diff 通道 | patches.test.ts | fenced 提取 / `diff --git` 兜底 / 双 fence 取全部 / 落盘相对路径 / fieldSlug 消毒 |
| guard | review.test.ts | G1 四态（pass / reject / skipped-非git）；G2 ignored id 命中与不命中；G3/G4 正则命中与误报豁免；只检 `+` 行不检上下文 |
| api-ui | api-ui.test.ts | plan 批次切片（R7）+ 跨轮唯一尝试（R6：produced 不重试 / rejected 重试一次 / 二败 given-up）；apply 的 prompt 含 §44.4 约束与字段上下文 |
| runtime 集成 | runtime-loop.test.ts / runtime-terminate.test.ts | scripted provider/agent 全链：2 轮递进到 backlog-empty；全 reject → 连续 N 轮提前终止（stopped-by=no-improvement）；maxIterations 触达；agent_iterations 行断言（含 after_coverage=NULL R3）；runs 行 status='agent-loop'；patches 文件名与留档布局 |
| config/接线 | config 包测试 + CLI 接线测试 | AgentConfigSchema 各态（type 非法 → CONFIG_INVALID）；loop 子命令解析（--max-iterations 覆盖）；E1/E2 路径 |
| E2E 真 claude | 不进 CI | demo 手动验收（§6） |

环境约束（沿袭）：Windows + Git Bash；`corepack pnpm`；根目录 `npx vitest run`；测试在 `packages/agent/src/__tests__/`；文件 ≤400 行；中文注释、CLI/测试输出英文。

---

## 6. 验收

### 6.1 CI 内自动化验收

1. 全套 `npx vitest run` 绿（Phase 4 基线 413 + 本期新增约 60-80）
2. 全包 build 绿（agent 包 tsup 产物可被 cli import）
3. demo `nx-mk.config.yml` 不强制加 agent 段（无配置 = 全默认值可跑）——README 示例给出可选段

### 6.2 demo 手动验收（人工执行，README 记步骤）

1. demo 起三服务 → `nx-mk run` 产出 coverage-report.json（含 missing required 字段）
2. `nx-mk loop` → 观察 stdout 摘要 + `.nx-mk/patches/` 落盘 + dashboard runs 列表出现 agent run
3. 人工抽检任一 patch 内容质量（§44.4：不碰 ignored、无 dump）
4. `git apply` + demo 重跑 `nx-mk run` → requiredCoverage 真实提升、dashboard 可见

---

## 附注 A：与 plan §33/§34/§38 原文的合同差异（全部为有意收缩）

| plan 原文 | 本期落地 | 理由 |
|---|---|---|
| §33 `ctx.coverage.missingRequiredFields()`（方法） | `ctx.report.missingRequiredFields`（数组属性，@nx-mk/coverage 类型直用） | report 已是 policy 过滤后的完备视图（R8），无需二次封装 |
| §33 `ctx.manifest.summary()` / `ctx.policy.summary()` | `ctx.manifestSummary` / `ctx.policySummary` 字符串（由 report 派生） | 同 R8；避免 agent 直连 manifest/policy 内部接口 |
| §33 `ctx.project.allowedFiles()` | 不收——文件访问边界由 provider 只读工具集承担（R1） | D1 下 agent 进程无写文件通道，白名单无对象 |
| §34 `generate()` / `review?()` | 不收，v0 仅 `edit()` | roadmap Phase 5 五项无 generate；guard 为纯静态（§3.6），不需要 AI review 通道 |
| §37 第 8-10 步 build/test/coverage verify + rollback | 收缩为静态 guard（U3：轮次产 diff 不验证）；rollback 不适用 | D1 无写盘，verify 无对象；真实验证 = 用户 apply 后重跑 run |
| §38 `rollbackOnRegression` | 配置不收 | 同上，收了误导（YAGNI） |
| §38 `maxIterations: 5` / `stopIfNoImprovementRounds: 2` | 逐字保留为默认值 | 忠实原文 |
| §25.9 agent_iterations | DDL 逐字（已存在于 `coverage/src/db/schema.ts:127`），本期只新增写入方 | 表结构零漂移；status 枚举值为本期定义：produced/rejected/failed/given-up |
| plan §9 `npx mk report` / `replay` / `migrate` | 均不在本期（report/replay 未见于已实现命令，migrate 属 SDK-CG3 后置） | roadmap Phase 5 五项之外 |
