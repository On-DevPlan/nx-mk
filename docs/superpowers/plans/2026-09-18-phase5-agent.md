# Phase 5 — Agent Loop v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `nx-mk loop` 读取最新 coverage report，把 missing required 字段分批交给本地 `claude` CLI 产 unified diff，经静态 review guard 落 `.nx-mk/patches/`，全程零工作区写入；`agent_iterations` 落共享库审计。

**Architecture:** 新包 `@nx-mk/agent` 三层实例化（plan §32）：agent-sdk 协议类型（types.ts）+ Agent Runtime（runtime.ts：批次/轮次/终止/审计）+ claude-code provider（provider/claude-code.ts：spawn 本地 CLI）+ 内置 api-ui-agent / review-agent（agents/）。CLI 侧 `nx-mk loop` 装配 provider 与两 agent 后注入 `runAgentLoop`（LoopDeps 缝，对齐 Phase 4 start.ts 的 StartDeps 模式）。

**Tech Stack:** TypeScript ESM（Node20 / tsup / vitest）、zod（config 段）、better-sqlite3（经 `@nx-mk/coverage` 的 `openCoverageDb` 复用）、本地 `claude` CLI（spawn，零新依赖）、真实 `git`（仅 `git apply --check` 验证 + T9 集成测试）。

**Spec:** `docs/superpowers/specs/2026-09-18-nx-mk-phase5-agent-design.md`（R1-R10 裁定 + §3.4 协议为唯一事实源；执行者必读）

## Global Constraints

- Windows + Git Bash 环境；包管理只用 `corepack pnpm`；根目录跑测试 `npx vitest run`（不要进包目录跑）。
- 测试文件布局：`packages/agent/src/__tests__/*.test.ts`（扁平，对齐 dashboard 包）；根级集成测试 `tests/integration/*.test.ts`。
- ESM 相对导入必须带 `.js` 后缀（`import { x } from './types.js'`）；`verbatimModuleSyntax` 开启 —— 纯类型导入用 `import type`。
- `noUncheckedIndexedAccess` 开启 —— 数组下标访问结果视为 `T | undefined`，需收窄（`arr[i]!` 或 if 判断）。
- 每文件 ≤400 行；中文注释；CLI stdout / 测试名与断言消息一律英文。
- 错误统一抛 `KernelError`（`@nx-mk/kernel`），CLI 顶层按 `mapErrorCodeToExit` 映射退出码。
- commit 信息 conventional 中文（如 `feat(agent): ...`）；**不加任何 attribution 行**（Co-Authored-By 等）。
- 真实 `claude` 子进程调用不进 CI —— provider 的 spawn 经 `RunClaudeFn` 注入替换。
- agent 包不在 vitest coverage thresholds 任何 glob 内（已核实 `vitest.config.ts`）—— 无需改 vitest 配置。
- suggest-diff 铁律（D1）：全链路零工作区写入 —— 唯一落盘目标是 `.nx-mk/runs/`、`.nx-mk/patches/`、`.nx-mk/coverage.db`。

## Plan-Level Rulings（spec 未逐字覆盖处的实施裁定）

| # | 裁定 | 理由 |
|---|---|---|
| PLN-1 | R6/R7 的尝试状态机在 **runtime.ts**（api-ui-agent 无状态）：`apiUiAgent.plan(ctx)` 渲染全量待办，runtime 持 `Map<fieldId, {tries, done}>` 做切片与重试判定 | 协议 `plan(ctx)` 无实例状态可存（spec §3.2 文字上的「plan → 待办批次」按此语义落地，语义不变） |
| PLN-2 | `TaskApplyResult` 增加可选 `patchRelPath?: string`；guard 流程改为「runtime 先写终稿路径 → review-agent verify（G1 需要落盘文件）→ reject 时 rename 进 `rejected/`」 | G1 `git apply --check` 只认文件；spec §3.6 的 guard-then-write 顺序物理上不可行 |
| PLN-3 | `AgentConfig` 镜像接口放 `agent/src/types.ts` 本地；config 包经 `z.infer` 导出同名类型；kernel **不**新增类型（`kernel/src/types.ts` 的 `Config` 无 collect/coverage/dashboard 先例，loop.ts 用 cast 读取 `config.agent`，对齐 start.ts 的 dashboard cast） | kernel 零漂移；类型单一事实源在 config schema |
| PLN-4 | review guard 的 verify 调用粒度 = **逐 task 单结果包装**（runtime 调 `verify(ctx, { results: [r] })`），AgentVerifyResult 逐 task 归因；插件签名（`AgentApplyResult` 入参）不变 | 逐 task 的 verdict 才能决定该 task 的 produced/rejected 状态 |
| PLN-5 | 二次失败（第 2 次尝试 rejected 或 failed）落库 status = `'given-up'`；`rejected`/`failed` 枚举值保留给首次失败 | R6「再败即放弃」的行级语义；每 attempt 一行，枚举恰好覆盖 |
| PLN-6 | `deps.reviewAgent.verify` 未提供（协议 verify 可选）时该 task 视为 pass | 可选语义的直译；运行时恒注入 createReviewAgent，仅测试可触达 |
| PLN-7 | 新增测试文件 `packages/agent/src/__tests__/sdk.test.ts`（spec §5 六文件之外的骨架冒烟）与 `packages/config/src/__tests__/agent-schema.test.ts`（对齐 dashboard-schema.test.ts 先例） | T1/T6 各需独立测试承载 |
| PLN-8 | `fieldSlug` 白名单含 `/`（spec §3.7 逐字），嵌套 slug 由 `writePatchFile` 的 `mkdirSync(recursive)` 兜底；`git apply <dir>/*.patch` 的 shell glob 不跨 `/`，属已知 v0 界限，README 注明 | spec 逐字优先 |
| PLN-9 | runtime 的 `.nx-mk` 目录 / patch 文件 / rename 写失败包装为 `KernelError('KERNEL_INTERNAL')`（E9 → 退出码 5）：setup 段与 writePatchFile / renameSync 调用经 `failInternal` 收口 | spec E9 逐字 —— 裸 Node 错误会被 CLI 顶层映射为退出码 1 |

## File Structure

```
packages/agent/                          # 新包（T1 起）
  package.json / tsup.config.ts / tsconfig.json
  src/
    types.ts                             # 协议类型（spec §3.4 唯一事实源）+ defineCoverageAgent + AgentConfig 镜像
    patches.ts                           # extractDiff / sanitizeFieldSlug / writePatchFile / toPosixRel / gitApplyCheck
    runtime.ts                           # runAgentLoop + AGENT_DEFAULTS + 状态机 + 落库
    provider/claude-code.ts              # createClaudeCodeProvider + RunClaudeFn 缝 + ENOENT 分类
    agents/api-ui.ts                     # planTasks / buildPrompt / applyTasks
    agents/review.ts                     # verifyDiff（G1-G4）+ createReviewAgent
    index.ts                             # 出口（逐任务扩充）
    __tests__/sdk.test.ts  patches.test.ts  claude-provider.test.ts
              review.test.ts  api-ui.test.ts
              runtime-loop.test.ts  runtime-terminate.test.ts
packages/config/src/schema.ts            # +Agent{Provider,Loop,}ConfigSchema + ConfigSchema.agent（T6）
packages/config/src/loader.ts            # LoadConfigInput.subcommand + 'loop'（T6）
packages/config/src/__tests__/agent-schema.test.ts  # 新（T6）
packages/kernel/src/types.ts             # ResolvedConfig.subcommand + 'loop'（T6）
packages/kernel/src/errors.ts            # +RUN_NOT_FOUND、+PROVIDER_UNAVAILABLE（T3 加错误码，T8 消费）
packages/cli/src/commands/loop.ts        # 新：loopMain（T8）
packages/cli/src/__tests__/loop.test.ts  # 新（T8）
packages/cli/src/index.ts                # loop 四件套接线（T8）
packages/cli/package.json                # +@nx-mk/agent 依赖（T8）
tests/integration/phase5-agent.test.ts   # 新：真 git 全链（T9）
examples/react-vite-demo/nx-mk.config.yml # 注释 agent 段示例（T10）
README.md                                # Agent Loop 使用段 + 包结构行（T10）
```

---

### Task 1: `@nx-mk/agent` 包骨架 + agent-sdk 协议类型

**Files:**
- Create: `packages/agent/package.json`
- Create: `packages/agent/tsup.config.ts`
- Create: `packages/agent/tsconfig.json`
- Create: `packages/agent/src/types.ts`
- Create: `packages/agent/src/index.ts`
- Test: `packages/agent/src/__tests__/sdk.test.ts`

**Interfaces:**
- Consumes: `CoverageReport` type from `@nx-mk/coverage`（已存在，`packages/coverage/src/analyzer/report.ts:48`）；`KernelError` from `@nx-mk/kernel`。
- Produces（后续所有任务消费）: `AgentTask`, `AgentPlan`, `TaskApplyResult`（含 `patchRelPath?`）, `AgentApplyResult`, `AgentVerifyResult`, `AgentContext`, `CoverageAgentPlugin`, `defineCoverageAgent`, `AgentEditInput`, `AgentEditOutput`, `AgentProvider`, `AgentConfig`（镜像，PLN-3）, `AgentProviderConfig`, `AgentLoopConfig`。全部从 `packages/agent/src/index.ts` re-export。

- [ ] **Step 1: 写失败测试**

`packages/agent/src/__tests__/sdk.test.ts`：

```ts
/**
 * agent-sdk 协议冒烟（spec §3.4）：协议类型可满足 + defineCoverageAgent 恒等。
 */
import { describe, it, expect } from 'vitest'
import {
  defineCoverageAgent,
  type AgentApplyResult,
  type AgentContext,
  type AgentPlan,
  type AgentVerifyResult,
  type CoverageAgentPlugin,
} from '../types.js'

// 满足协议的最小插件（类型收口：任何字段缺失都会编译失败）
const fake: CoverageAgentPlugin = {
  name: 'fake',
  version: '0.0.1',
  capabilities: ['plan', 'apply'],
  plan: async (_ctx: AgentContext): Promise<AgentPlan> => ({ tasks: [] }),
  apply: async (_ctx: AgentContext, plan: AgentPlan): Promise<AgentApplyResult> => ({
    results: plan.tasks.map((t) => ({ task: t, status: 'failed', error: 'not-implemented' })),
  }),
  verify: async (): Promise<AgentVerifyResult> => ({ verdict: 'pass', checks: [] }),
}

describe('defineCoverageAgent', () => {
  it('returns the same plugin object (identity)', () => {
    expect(defineCoverageAgent(fake)).toBe(fake)
  })

  it('accepts a plugin without optional verify', () => {
    const { verify: _verify, ...rest } = fake
    const bare: CoverageAgentPlugin = rest
    expect(defineCoverageAgent(bare).verify).toBeUndefined()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/agent/src/__tests__/sdk.test.ts`
Expected: FAIL（找不到 `../types.js` —— 包尚不存在）

- [ ] **Step 3: 建包骨架**

`packages/agent/package.json`：

```json
{
  "name": "@nx-mk/agent",
  "version": "0.1.0",
  "private": true,
  "description": "nx-mk agent-sdk — coverage-gap Agent Loop (suggest-diff, claude-code provider)",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "clean": "rm -rf dist *.tsbuildinfo"
  },
  "dependencies": {
    "@nx-mk/kernel": "workspace:*",
    "@nx-mk/coverage": "workspace:*",
    "better-sqlite3": "^11.10.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.13",
    "@types/node": "^20.10.0",
    "tsup": "^8.0.2",
    "typescript": "^5.3.3",
    "vitest": "^1.0.4"
  }
}
```

（better-sqlite3 为 spec §3.3 逐字：runtime 本期只经 `CoverageDb` 触达 sqlite，列依赖保持与 coverage 版本对齐、为后续直查留位。）

`packages/agent/tsup.config.ts`：

```ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ['better-sqlite3', '@nx-mk/kernel', '@nx-mk/coverage'],
})
```

`packages/agent/tsconfig.json`（对齐 coverage）：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "allowSyntheticDefaultImports": true,
    "declaration": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 4: 写 types.ts（协议唯一事实源，spec §3.4 逐字 + PLN-2/PLN-3）**

`packages/agent/src/types.ts`：

```ts
/**
 * agent-sdk 协议类型（spec §3.4 —— 唯一事实源；plan §33 的收缩版，差异见 spec 附注 A）。
 *
 * suggest-diff 铁律（D1）：全链路零工作区写入 —— agent 只产出 diff 文本，
 * 落盘目标仅 .nx-mk/patches/；可应用性验证 = git apply --check（不落盘）。
 */
import type { CoverageReport } from '@nx-mk/coverage'

// 任务：v0 只有 render-field 一种；字段级 diff 粒度
export interface AgentTask {
  type: 'render-field'
  fieldId: string           // FieldCoverageItem.fieldId
  fieldPath: string
  endpointId: string | null // FieldCoverageItem.endpointId ?? null
  reason: string            // missing / weak-evidence 等人读理由
}

export interface AgentPlan { tasks: AgentTask[] }

// 逐 task 的 apply 结果：diff 文本或失败原因（不抛异常，错误即结果）。
// patchRelPath 由 runtime 落盘后回填（PLN-2：guard 的 G1 需要落盘文件）
export interface TaskApplyResult {
  task: AgentTask
  status: 'diff-produced' | 'failed'
  diffText?: string        // status=diff-produced 时存在
  error?: string           // status=failed 时的人读原因
  patchRelPath?: string    // 相对 projectRoot 的 posix 路径；runtime 回填
}

export interface AgentApplyResult { results: TaskApplyResult[] }

// review verdict：静态 guard（review-agent）的产出
export interface AgentVerifyResult {
  verdict: 'pass' | 'reject'
  checks: { name: string; outcome: 'pass' | 'reject' | 'skipped'; detail?: string }[]
}

// §33 收缩版上下文（R8：manifest/policy 摘要由 report 派生为文本）
export interface AgentContext {
  report: CoverageReport      // 只读输入（@nx-mk/coverage 类型直用）
  manifestSummary: string     // R8
  policySummary: string       // R8
  projectRoot: string         // nx-mk.config.yml 所在目录（claude cwd / git apply cwd）
  ai: AgentProvider
  log: (msg: string) => void
}

// §33 逐字形状（capabilities 收为 string 别名；verify 可选 —— PLN-6）
export interface CoverageAgentPlugin {
  name: string
  version: string
  capabilities: string[]
  plan(ctx: AgentContext): Promise<AgentPlan>
  apply(ctx: AgentContext, plan: AgentPlan): Promise<AgentApplyResult>
  verify?(ctx: AgentContext, result: AgentApplyResult): Promise<AgentVerifyResult>
}

// SDK 入口：恒等函数（类型收口用，与内核 definePlugin 同风格）
export function defineCoverageAgent(plugin: CoverageAgentPlugin): CoverageAgentPlugin {
  return plugin
}

// §34 收缩版：v0 仅 edit 通道（generate/review 不收，见 spec 附注 A）
export interface AgentEditInput {
  instructions: string
  context?: Record<string, unknown>   // 渲染进 prompt 的结构化上下文
}
export interface AgentEditOutput { diffText: string }
export interface AgentProvider {
  name: string
  edit(input: AgentEditInput): Promise<AgentEditOutput>
}

// ---------------------------------------------------------------------
// config `agent:` 段镜像（PLN-3：kernel 不新增类型；单一事实源在
// @nx-mk/config 的 zod schema —— 此处形状必须与其保持一致）
// ---------------------------------------------------------------------
export interface AgentProviderConfig {
  type: 'claude-code'
  timeoutMs?: number
  maxTurns?: number
}
export interface AgentLoopConfig {
  maxIterations?: number
  stopIfNoImprovementRounds?: number
  maxTasksPerIteration?: number
}
export interface AgentConfig {
  provider?: AgentProviderConfig
  loop?: AgentLoopConfig
}
```

- [ ] **Step 5: 写出口 `packages/agent/src/index.ts`**

```ts
/**
 * @nx-mk/agent —— coverage-gap Agent Loop（suggest-diff 模式，spec §1）
 */
export {
  defineCoverageAgent,
  type AgentTask,
  type AgentPlan,
  type TaskApplyResult,
  type AgentApplyResult,
  type AgentVerifyResult,
  type AgentContext,
  type CoverageAgentPlugin,
  type AgentEditInput,
  type AgentEditOutput,
  type AgentProvider,
  type AgentConfig,
  type AgentProviderConfig,
  type AgentLoopConfig,
} from './types.js'
```

- [ ] **Step 6: 链接依赖 + 跑测试确认通过**

Run: `corepack pnpm install`（注册 workspace 链接）
Run: `npx vitest run packages/agent/src/__tests__/sdk.test.ts`
Expected: PASS（2 tests）

- [ ] **Step 7: typecheck + commit**

Run: `corepack pnpm -F @nx-mk/agent typecheck`
Expected: 无错误

```bash
git add packages/agent
git commit -m "feat(agent): @nx-mk/agent 包骨架 + agent-sdk 协议类型 + defineCoverageAgent"
```

---

### Task 2: diff 通道 patches.ts（R9 提取 / fieldSlug / 落盘 / G1 gitApplyCheck）

**Files:**
- Create: `packages/agent/src/patches.ts`
- Modify: `packages/agent/src/index.ts`（追加 re-export）
- Test: `packages/agent/src/__tests__/patches.test.ts`

**Interfaces:**
- Consumes: 无（纯 node API）。
- Produces（T4/T7/T8 消费）:
  - `extractDiff(output: string): string | null`
  - `sanitizeFieldSlug(fieldId: string): string`
  - `writePatchFile(patchDir: string, filename: string, diffText: string): string`（返回绝对路径）
  - `toPosixRel(absPath: string, projectRoot: string): string`
  - `gitApplyCheck(patchAbsPath: string, cwd: string, run?: GitApplyFn): Promise<'pass' | 'reject' | 'skipped'>`
  - `type GitApplyFn = (args: string[], cwd: string) => Promise<{ code: number; stderr: string }>`

- [ ] **Step 1: 写失败测试**

`packages/agent/src/__tests__/patches.test.ts`：

```ts
/**
 * diff 通道单测（spec §3.7 / R9 / G1）：提取、slug 消毒、落盘、git apply --check 四态。
 * gitApplyCheck 用注入替身 —— 真实 git 全链在 tests/integration（T9）。
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { extractDiff, sanitizeFieldSlug, toPosixRel, writePatchFile, gitApplyCheck } from '../patches.js'

describe('extractDiff (R9)', () => {
  it('extracts a single fenced diff block', () => {
    const out = 'Here is my change:\n```diff\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-a\n+b\n```\ndone'
    expect(extractDiff(out)).toBe('--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-a\n+b')
  })

  it('joins multiple fenced blocks in order', () => {
    const out = '```diff\n@@ -1 +1 @@\n```\ntext\n```diff\n@@ -9 +9 @@\n```'
    expect(extractDiff(out)).toBe('@@ -1 +1 @@\n@@ -9 +9 @@')
  })

  it('falls back to full text when it contains diff --git without fences', () => {
    const out = 'diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts'
    expect(extractDiff(out)).toBe(out)
  })

  it('returns null when neither fence nor diff --git (E6)', () => {
    expect(extractDiff('I cannot help with that.')).toBeNull()
  })

  it('does not treat non-diff fences as diff blocks', () => {
    const out = '```ts\nconst a = 1\n```'
    expect(extractDiff(out)).toBeNull()
  })
})

describe('sanitizeFieldSlug (spec §3.7)', () => {
  it('replaces chars outside the whitelist with underscore', () => {
    expect(sanitizeFieldSlug('GET /api/users.200.body[].name')).toBe('GET_/api/users.200.body[].name')
  })

  it('truncates to 40 chars', () => {
    expect(sanitizeFieldSlug('a'.repeat(60))).toHaveLength(40)
  })
})

describe('writePatchFile / toPosixRel', () => {
  it('writes the diff with trailing newline and returns a posix relative path', () => {
    const root = mkdtempSync(join(tmpdir(), 'nx-mk-patches-'))
    const dir = join(root, '.nx-mk', 'patches', 'agent_x')
    const abs = writePatchFile(dir, 'iter-1-field.patch', '+hello')
    expect(readFileSync(abs, 'utf8')).toBe('+hello\n')
    const rel = toPosixRel(abs, root)
    expect(rel).toBe('.nx-mk/patches/agent_x/iter-1-field.patch')
    expect(rel).not.toContain('\\')
  })
})

describe('gitApplyCheck (G1/R10)', () => {
  const okRun = async () => ({ code: 0, stderr: '' })
  const conflictRun = async () => ({ code: 1, stderr: 'error: patch does not apply' })
  const noGitRun = async () => ({ code: 128, stderr: 'fatal: not a git repository (or any of the parent directories): .git' })

  it('returns pass on exit 0', async () => {
    expect(await gitApplyCheck('p.patch', '/root', okRun)).toBe('pass')
  })
  it('returns reject on non-zero without not-a-git-repo stderr', async () => {
    expect(await gitApplyCheck('p.patch', '/root', conflictRun)).toBe('reject')
  })
  it('returns skipped when the dir is not a git repository (R10)', async () => {
    expect(await gitApplyCheck('p.patch', '/root', noGitRun)).toBe('skipped')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/agent/src/__tests__/patches.test.ts`
Expected: FAIL（`../patches.js` 不存在）

- [ ] **Step 3: 实现 patches.ts**

`packages/agent/src/patches.ts`：

```ts
/**
 * diff 通道（spec §3.7 / R9 / G1）—— 提取、落盘、git apply --check 封装。
 * R9：不解析 diff —— git 是唯一 truth，可应用性全部交给 git apply --check。
 */
import { execFile } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

// 从模型输出提取 diff 文本（R9）：优先全部 fenced ```diff / ```patch 块（按出现顺序拼接）；
// 兜底：输出整体含 'diff --git' 时取全文；否则 null（E6 → task failed）
export function extractDiff(output: string): string | null {
  const blocks: string[] = []
  for (const m of output.matchAll(/```(?:diff|patch)[^\n]*\n([\s\S]*?)```/g)) {
    const body = m[1]
    if (body && body.trim()) blocks.push(body.trimEnd())
  }
  if (blocks.length > 0) return blocks.join('\n')
  if (output.includes('diff --git')) return output.trim()
  return null
}

// fieldId → 文件名安全 slug（spec §3.7 逐字）：白名单外字符替换 '_'，截断 40。
// 白名单含 '/'（spec 逐字）—— 嵌套 slug 由 writePatchFile 的 mkdirSync(recursive) 兜底（PLN-8）
export function sanitizeFieldSlug(fieldId: string): string {
  return fieldId.replace(/[^a-zA-Z0-9._/-]/g, '_').slice(0, 40)
}

// 落盘一个 patch 文件（目录不存在则递归创建），返回绝对路径
export function writePatchFile(patchDir: string, filename: string, diffText: string): string {
  mkdirSync(patchDir, { recursive: true })
  const abs = join(patchDir, filename)
  writeFileSync(abs, diffText.endsWith('\n') ? diffText : diffText + '\n', 'utf8')
  return abs
}

// 绝对路径 → 相对 projectRoot 的 posix 风格路径（diff_path 落库 / stdout 摘要统一用）
export function toPosixRel(absPath: string, projectRoot: string): string {
  return relative(projectRoot, absPath).replaceAll('\\', '/')
}

// git apply --check 的可注入执行缝（单测不依赖真实 git）
export interface GitRunResult { code: number; stderr: string }
export type GitApplyFn = (args: string[], cwd: string) => Promise<GitRunResult>

function defaultGitApply(args: string[], cwd: string): Promise<GitRunResult> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, windowsHide: true }, (err, _stdout, stderr) => {
      if (err) resolve({ code: typeof err.code === 'number' ? err.code : 1, stderr: String(stderr) })
      else resolve({ code: 0, stderr: '' })
    })
  })
}

// G1：`git apply --check`（E7 非 → 'reject'）；非 git 仓库 → 'skipped'（R10，verdict 由 G2-G4 决定）
export async function gitApplyCheck(
  patchAbsPath: string,
  cwd: string,
  run: GitApplyFn = defaultGitApply,
): Promise<'pass' | 'reject' | 'skipped'> {
  const r = await run(['apply', '--check', patchAbsPath], cwd)
  if (r.code === 0) return 'pass'
  if (/not a git repository/i.test(r.stderr)) return 'skipped'
  return 'reject'
}
```

- [ ] **Step 4: index.ts 追加出口**

在 `packages/agent/src/index.ts` 末尾追加：

```ts
export {
  extractDiff,
  sanitizeFieldSlug,
  writePatchFile,
  toPosixRel,
  gitApplyCheck,
  type GitApplyFn,
  type GitRunResult,
} from './patches.js'
```

- [ ] **Step 5: 跑测试确认通过 + typecheck + commit**

Run: `npx vitest run packages/agent/src/__tests__/patches.test.ts`
Expected: PASS（10 tests）
Run: `corepack pnpm -F @nx-mk/agent typecheck`
Expected: 无错误

```bash
git add packages/agent
git commit -m "feat(agent): diff 通道 —— extractDiff / fieldSlug 消毒 / 落盘 / gitApplyCheck（R9/G1）"
```

---

### Task 3: claude-code provider（R1 spawn + ENOENT→PROVIDER_UNAVAILABLE）

**Files:**
- Create: `packages/agent/src/provider/claude-code.ts`
- Modify: `packages/kernel/src/errors.ts`（+`PROVIDER_UNAVAILABLE`，E4）
- Modify: `packages/agent/src/index.ts`（追加 re-export）
- Test: `packages/agent/src/__tests__/claude-provider.test.ts`

**Interfaces:**
- Consumes: `extractDiff`（Task 2）、`KernelError`（kernel）、`AgentEditInput/AgentEditOutput/AgentProvider`（Task 1）。
- Produces（T5/T8 消费）:
  - `READONLY_ALLOWED_TOOLS: 'Read Grep Glob'`（常量，测试快照用）
  - `type RunClaudeResult = { code: number; stdout: string; stderr: string }`
  - `type RunClaudeFn = (args: string[], cwd: string, timeoutMs: number) => Promise<RunClaudeResult>`
  - `defaultRunClaude(args, cwd, timeoutMs): Promise<RunClaudeResult>`（spawn + 超时 kill）
  - `classifyClaudeSpawnError(err: unknown): unknown`（ENOENT → `KernelError('PROVIDER_UNAVAILABLE')`，其余原样返回）
  - `createClaudeCodeProvider(opts: { projectRoot: string; timeoutMs: number; maxTurns: number }, inject?: { runClaude?: RunClaudeFn }): AgentProvider`

- [ ] **Step 1: kernel errors.ts 扩错误码（先改被依赖方）**

`packages/kernel/src/errors.ts` 三处修改：

1. `ErrorCode` union 在 `'KERNEL_INTERNAL'` 前追加两行（spec §4 逐字注释）：

```ts
  | 'RUN_NOT_FOUND'          // → 2（运行前置产物缺失，用户可自修）
  | 'PROVIDER_UNAVAILABLE'   // → 2（外部依赖缺失，用户可自修）
  | 'KERNEL_INTERNAL'
```

2. `mapErrorCodeToExit` 的配置类 case 扩为：

```ts
    // 配置类：文件缺失或内容非法；运行前置产物缺失（loop 无 report）；
    // 外部依赖缺失（claude CLI 未安装）→ 退出码 2（配置/运行前置错误）
    case 'CONFIG_NOT_FOUND':
    case 'CONFIG_INVALID':
    case 'RUN_NOT_FOUND':
    case 'PROVIDER_UNAVAILABLE':
      return 2
```

3. 文件头注释第 5 行同步扩展：`2=配置错误、3=插件加载错误...` → `2=配置/运行前置错误、3=插件加载错误...`

- [ ] **Step 2: 写失败测试**

`packages/agent/src/__tests__/claude-provider.test.ts`：

```ts
/**
 * claude-code provider 单测（spec §3.5 / E4-E6）：spawn 参数快照 + stdout 各态。
 * RunClaudeFn 注入替身 —— 真实子进程不进 CI。
 */
import { describe, it, expect } from 'vitest'
import { KernelError } from '@nx-mk/kernel'
import {
  READONLY_ALLOWED_TOOLS,
  classifyClaudeSpawnError,
  createClaudeCodeProvider,
  type RunClaudeResult,
} from '../provider/claude-code.js'

const OK: RunClaudeResult = {
  code: 0,
  stdout: JSON.stringify({ result: '```diff\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n```', is_error: false }),
  stderr: '',
}

function makeProvider(run: RunClaudeFn, timeoutMs = 1000, maxTurns = 7) {
  return createClaudeCodeProvider({ projectRoot: '/proj', timeoutMs, maxTurns }, { runClaude: run })
}

describe('createClaudeCodeProvider', () => {
  it('spawns claude with read-only tools, json output and max-turns (R1)', async () => {
    const seen: { args: string[]; cwd: string; timeoutMs: number }[] = []
    const provider = makeProvider(async (args, cwd, timeoutMs) => {
      seen.push({ args, cwd, timeoutMs })
      return OK
    })
    await provider.edit({ instructions: 'do it' })
    expect(seen).toHaveLength(1)
    const call = seen[0]!
    expect(call.cwd).toBe('/proj')
    expect(call.timeoutMs).toBe(1000)
    const at = call.args.indexOf('--allowedTools')
    expect(at).toBeGreaterThan(-1)
    expect(call.args[at + 1]).toBe(READONLY_ALLOWED_TOOLS)
    expect(READONLY_ALLOWED_TOOLS).toBe('Read Grep Glob')
    expect(call.args).toContain('--output-format')
    expect(call.args[call.args.indexOf('--output-format') + 1]).toBe('json')
    expect(call.args[call.args.indexOf('--max-turns') + 1]).toBe('7')
    expect(call.args[0]).toBe('-p')
    expect(call.args[1]).toContain('do it')
  })

  it('returns the extracted diff text (R9)', async () => {
    const provider = makeProvider(async () => OK)
    const out = await provider.edit({ instructions: 'x' })
    expect(out.diffText).toBe('--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b')
  })

  it('throws a task-level error on is_error (E5)', async () => {
    const provider = makeProvider(async () => ({
      code: 0,
      stdout: JSON.stringify({ result: 'boom', is_error: true }),
      stderr: '',
    }))
    await expect(provider.edit({ instructions: 'x' })).rejects.toThrow(/is_error/)
  })

  it('throws on non-zero exit (E5)', async () => {
    const provider = makeProvider(async () => ({ code: 1, stdout: '', stderr: 'bad args' }))
    await expect(provider.edit({ instructions: 'x' })).rejects.toThrow(/exited with code 1/)
  })

  it('throws on non-JSON stdout (E5)', async () => {
    const provider = makeProvider(async () => ({ code: 0, stdout: 'not json', stderr: '' }))
    await expect(provider.edit({ instructions: 'x' })).rejects.toThrow(/not valid JSON/)
  })

  it('throws when no diff can be extracted (E6)', async () => {
    const provider = makeProvider(async () => ({
      code: 0,
      stdout: JSON.stringify({ result: 'no diff here', is_error: false }),
      stderr: '',
    }))
    await expect(provider.edit({ instructions: 'x' })).rejects.toThrow(/no diff/)
  })

  it('passes through timeout errors as task-level failures (E5)', async () => {
    const provider = makeProvider(async () => {
      throw new Error('claude timed out after 1000ms')
    })
    await expect(provider.edit({ instructions: 'x' })).rejects.toThrow(/timed out/)
  })

  it('maps ENOENT to KernelError PROVIDER_UNAVAILABLE (E4, process-level)', async () => {
    const enoent = Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' })
    const provider = makeProvider(async () => {
      throw enoent
    })
    await expect(provider.edit({ instructions: 'x' })).rejects.toBeInstanceOf(KernelError)
    await expect(provider.edit({ instructions: 'x' })).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })
  })

  it('classifyClaudeSpawnError passes unknown errors through unchanged', () => {
    const err = new Error('weird')
    expect(classifyClaudeSpawnError(err)).toBe(err)
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run packages/agent/src/__tests__/claude-provider.test.ts`
Expected: FAIL（`../provider/claude-code.js` 不存在）

- [ ] **Step 4: 实现 provider/claude-code.ts**

```ts
/**
 * claude-code provider（spec §3.5 / R1 / E4-E6）—— spawn 本地 claude CLI。
 * 只读工具集（Read Grep Glob）：子进程内部也无写能力，D1 双保险。
 * RunClaudeFn 注入缝：真实子进程不进 CI。
 */
import { spawn } from 'node:child_process'
import { KernelError } from '@nx-mk/kernel'
import { extractDiff } from '../patches.js'
import type { AgentEditInput, AgentEditOutput, AgentProvider } from '../types.js'

// R1 逐字：只读三件套（单 arg、空格分隔）
export const READONLY_ALLOWED_TOOLS = 'Read Grep Glob'

export interface RunClaudeResult { code: number; stdout: string; stderr: string }
export type RunClaudeFn = (args: string[], cwd: string, timeoutMs: number) => Promise<RunClaudeResult>

// 默认实现：spawn claude，collect stdout/stderr；超时 kill（E5 → task failed）
export function defaultRunClaude(args: string[], cwd: string, timeoutMs: number): Promise<RunClaudeResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, { cwd, windowsHide: true })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      reject(new Error(`claude timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    child.stdout.on('data', (d: Buffer) => { stdout += String(d) })
    child.stderr.on('data', (d: Buffer) => { stderr += String(d) })
    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}

// spawn 失败分类（E4）：ENOENT → PROVIDER_UNAVAILABLE（进程级 —— CLI 没装 claude
// 时整条 loop 无意义）；其余错误原样返回（task 级）
export function classifyClaudeSpawnError(err: unknown): unknown {
  if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
    return new KernelError(
      'PROVIDER_UNAVAILABLE',
      "claude CLI not found — install it (npm i -g @anthropic-ai/claude-code) and run 'claude' once to log in",
      err,
    )
  }
  return err
}

export interface ClaudeCodeProviderOptions {
  projectRoot: string
  timeoutMs: number
  maxTurns: number
}

export function createClaudeCodeProvider(
  opts: ClaudeCodeProviderOptions,
  inject?: { runClaude?: RunClaudeFn },
): AgentProvider {
  const runClaude = inject?.runClaude ?? defaultRunClaude
  return {
    name: 'claude-code',
    async edit(input: AgentEditInput): Promise<AgentEditOutput> {
      const args = [
        '-p', renderPrompt(input),
        '--output-format', 'json',
        '--allowedTools', READONLY_ALLOWED_TOOLS,
        '--max-turns', String(opts.maxTurns),
      ]
      let r: RunClaudeResult
      try {
        r = await runClaude(args, opts.projectRoot, opts.timeoutMs)
      } catch (err) {
        throw classifyClaudeSpawnError(err)
      }
      if (r.code !== 0) {
        throw new Error(`claude exited with code ${r.code}${r.stderr ? `: ${r.stderr.trim().slice(0, 200)}` : ''}`)
      }
      let parsed: { result?: string; is_error?: boolean }
      try {
        parsed = JSON.parse(r.stdout) as { result?: string; is_error?: boolean }
      } catch {
        throw new Error('claude stdout is not valid JSON (--output-format json expected)')
      }
      if (parsed.is_error) {
        throw new Error(`claude returned is_error: ${(parsed.result ?? '').trim().slice(0, 200)}`)
      }
      const diff = extractDiff(parsed.result ?? '')
      if (!diff) throw new Error('no diff block found in claude output (E6)')
      return { diffText: diff }
    },
  }
}

// 组装最终 prompt：instructions + 可选结构化 context（逐行 key: value）
function renderPrompt(input: AgentEditInput): string {
  const parts = [input.instructions]
  if (input.context) {
    const lines = Object.entries(input.context).map(
      ([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`,
    )
    parts.push(lines.join('\n'))
  }
  return parts.join('\n\n')
}
```

- [ ] **Step 5: index.ts 追加出口**

```ts
export {
  READONLY_ALLOWED_TOOLS,
  defaultRunClaude,
  classifyClaudeSpawnError,
  createClaudeCodeProvider,
  type RunClaudeFn,
  type RunClaudeResult,
  type ClaudeCodeProviderOptions,
} from './provider/claude-code.js'
```

- [ ] **Step 6: 跑测试确认通过 + kernel 回归 + commit**

Run: `npx vitest run packages/agent/src/__tests__/claude-provider.test.ts packages/kernel/src/__tests__`
Expected: agent 测试 PASS（9 tests）；kernel 既有测试 PASS（错误码扩展不破坏映射既有值）
Run: `corepack pnpm -F @nx-mk/kernel typecheck && corepack pnpm -F @nx-mk/agent typecheck`
Expected: 无错误

```bash
git add packages/agent packages/kernel
git commit -m "feat(agent,kernel): claude-code provider —— 只读工具集 spawn + ENOENT→PROVIDER_UNAVAILABLE"
```

---

### Task 4: review-agent 静态 guard（G1-G4）

**Files:**
- Create: `packages/agent/src/agents/review.ts`
- Modify: `packages/agent/src/index.ts`（追加 re-export）
- Test: `packages/agent/src/__tests__/review.test.ts`

**Interfaces:**
- Consumes: `gitApplyCheck` / `GitApplyFn`（Task 2）、`defineCoverageAgent` / `AgentContext` / `AgentApplyResult` / `AgentVerifyResult` / `CoverageAgentPlugin`（Task 1）。
- Produces（T7 消费）:
  - `addedLines(diffText: string): string[]`（`+` 开头且非 `+++`）
  - `verifyDiff(ctx: AgentContext, result: AgentApplyResult, inject?: { applyCheck?: (patchAbsPath: string, cwd: string) => Promise<'pass' | 'reject' | 'skipped'> }): Promise<AgentVerifyResult>`（inject 缝是**已映射**的 G1 结果，默认 `(p, c) => gitApplyCheck(p, c)`）
  - `createReviewAgent(): CoverageAgentPlugin`（name=`review-agent`，verify=verifyDiff）

- [ ] **Step 1: 写失败测试**

`packages/agent/src/__tests__/review.test.ts`：

```ts
/**
 * review-agent 静态 guard 单测（spec §3.6 / R5 / R10 / D3）：
 * G1 四态 + G2 ignored-render + G3 json-dump + G4 console-probe + 只检 '+' 行。
 * G1 走已映射的注入替身（真实 git 全链在 T9）。
 */
import { describe, it, expect } from 'vitest'
import { verifyDiff } from '../agents/review.js'
import type { AgentApplyResult, AgentContext, CoverageReport } from '../types.js'

// 最小 report：只用到 ignoredReturnedFields
function makeReport(ignoredIds: string[] = []): CoverageReport {
  return {
    runId: 'run_x',
    metrics: {
      requiredCoverage: 0.5, effectiveCoverage: 0.5, rawBackendFieldCoverage: 0.5,
      endpointsTotal: 0, endpointsCalled: 0, fieldsTotal: 0, fieldsReturned: 0,
      requiredFields: 0, missingRequiredFields: 0, ignoredReturnedFields: ignoredIds.length,
      suspiciousFields: 0,
    },
    missingRequiredFields: [],
    weakEvidenceFields: [],
    ignoredReturnedFields: ignoredIds.map((id) => ({
      fieldId: id, fieldPath: id, state: 'ignored' as const, policyStatus: 'ignored' as const,
    })),
    suspiciousCoverage: [],
    endpoints: [],
    requests: [],
  }
}

function makeCtx(report = makeReport()): AgentContext {
  return {
    report,
    manifestSummary: 'Manifest endpoints: (none)',
    policySummary: 'Policy summary: test',
    projectRoot: '/proj',
    ai: { name: 'fake', edit: async () => ({ diffText: '' }) },
    log: () => {},
  }
}

function oneResult(diffText: string): AgentApplyResult {
  return {
    results: [{ task: { type: 'render-field', fieldId: 'f1', fieldPath: 'data.name', endpointId: null, reason: 'missing' }, status: 'diff-produced', diffText, patchRelPath: '.nx-mk/patches/x/p.patch' }],
  }
}

const PASS_G1 = async () => 'pass' as const
const REJECT_G1 = async () => 'reject' as const
const SKIP_G1 = async () => 'skipped' as const

describe('verifyDiff', () => {
  it('G1: rejects when git apply --check fails (E7)', async () => {
    const vr = await verifyDiff(makeCtx(), oneResult('+ok'), { applyCheck: REJECT_G1 })
    expect(vr.verdict).toBe('reject')
    expect(vr.checks.find((c) => c.name === 'apply-check')?.outcome).toBe('reject')
  })

  it('G1: passes on exit 0', async () => {
    const vr = await verifyDiff(makeCtx(), oneResult('+ok'), { applyCheck: PASS_G1 })
    expect(vr.verdict).toBe('pass')
  })

  it('G1: skipped on non-git dir — verdict decided by static rules only (R10)', async () => {
    const vr = await verifyDiff(makeCtx(), oneResult('+ok'), { applyCheck: SKIP_G1 })
    expect(vr.verdict).toBe('pass')
    expect(vr.checks.find((c) => c.name === 'apply-check')?.outcome).toBe('skipped')
  })

  it('G2: rejects data-mk-field pointing at an ignored field id (D3)', async () => {
    const ctx = makeCtx(makeReport(['data.internalRiskScore']))
    const vr = await verifyDiff(ctx, oneResult('+  <span data-mk-field="data.internalRiskScore">{x}</span>'), { applyCheck: PASS_G1 })
    expect(vr.verdict).toBe('reject')
    expect(vr.checks.find((c) => c.name === 'ignored-render')).toBeTruthy()
  })

  it('G2: non-ignored data-mk-field passes', async () => {
    const ctx = makeCtx(makeReport(['data.internalRiskScore']))
    const vr = await verifyDiff(ctx, oneResult('+  <span data-mk-field="data.name">{x}</span>'), { applyCheck: PASS_G1 })
    expect(vr.verdict).toBe('pass')
  })

  it('G3: rejects JSON.stringify with response-like context nearby (R5)', async () => {
    const vr = await verifyDiff(makeCtx(), oneResult([
      '+  const out = JSON.stringify(res.data)',
      '+  return <pre>{out}</pre>',
    ].join('\n')), { applyCheck: PASS_G1 })
    expect(vr.verdict).toBe('reject')
    expect(vr.checks.find((c) => c.name === 'json-dump')).toBeTruthy()
  })

  it('G3: JSON.stringify without response context passes (false-positive exemption)', async () => {
    const vr = await verifyDiff(makeCtx(), oneResult('+  const s = JSON.stringify(configSnapshot)'), { applyCheck: PASS_G1 })
    expect(vr.verdict).toBe('pass')
  })

  it('G4: rejects console.log mentioning field/coverage (R5)', async () => {
    const vr = await verifyDiff(makeCtx(), oneResult("+  console.log('field hit', f)"), { applyCheck: PASS_G1 })
    expect(vr.verdict).toBe('reject')
    expect(vr.checks.find((c) => c.name === 'console-probe')).toBeTruthy()
  })

  it('only added lines are checked — context lines never trigger', async () => {
    const vr = await verifyDiff(makeCtx(), oneResult([
      ' const unchanged = 1',
      "-  console.log('field old', f)",
      "+  const ready = true",
    ].join('\n')), { applyCheck: PASS_G1 })
    expect(vr.verdict).toBe('pass')
  })

  it('failed tasks get a skipped apply-check and do not fail the verdict', async () => {
    const vr = await verifyDiff(makeCtx(), {
      results: [{ task: { type: 'render-field', fieldId: 'f1', fieldPath: 'd', endpointId: null, reason: 'r' }, status: 'failed', error: 'no diff' }],
    }, { applyCheck: REJECT_G1 })
    expect(vr.verdict).toBe('pass')
    expect(vr.checks[0]?.outcome).toBe('skipped')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/agent/src/__tests__/review.test.ts`
Expected: FAIL（`../agents/review.js` 不存在）

- [ ] **Step 3: 实现 agents/review.ts**

```ts
/**
 * review-agent（spec §3.6 / U3）—— v0 纯静态规则引擎，不调 AI：
 * G1 git apply --check；G2 ignored-render；G3 json-dump；G4 console-probe。
 * 只检查 diff 新增行（'+' 开头、非 '+++'）；任一 reject 即该 diff 不进 accepted 清单。
 */
import { join } from 'node:path'
import { gitApplyCheck } from '../patches.js'
import {
  defineCoverageAgent,
  type AgentApplyResult,
  type AgentContext,
  type AgentVerifyResult,
  type CoverageAgentPlugin,
} from '../types.js'

// 新增行：'+' 开头且非 '+++'（git unified diff 头不算新增内容）
export function addedLines(diffText: string): string[] {
  return diffText.split(/\r?\n/).filter((l) => l.startsWith('+') && !l.startsWith('+++'))
}

const DATA_MK_FIELD = /data-mk-field=["']([^"']+)["']/g
const JSON_STRINGIFY = /JSON\.stringify\(/
const RESPONSE_CONTEXT = /\bresponse\b|\bres\.|\bdata\b/i
const CONSOLE_LOG = /console\.log\(/
const FIELD_WORD = /\bfield\b|\bcoverage\b/i

// G1 的可注入缝（已映射结果）；默认走真实 gitApplyCheck
export type ApplyCheckFn = (patchAbsPath: string, cwd: string) => Promise<'pass' | 'reject' | 'skipped'>

export async function verifyDiff(
  ctx: AgentContext,
  result: AgentApplyResult,
  inject?: { applyCheck?: ApplyCheckFn },
): Promise<AgentVerifyResult> {
  const checkGit: ApplyCheckFn = inject?.applyCheck ?? ((p, c) => gitApplyCheck(p, c))
  const checks: AgentVerifyResult['checks'] = []
  let verdict: AgentVerifyResult['verdict'] = 'pass'
  const reject = (name: string, detail: string) => {
    checks.push({ name, outcome: 'reject', detail })
    verdict = 'reject'
  }

  // G2 的 ignored id 集合来自 report（R8：不读 manifest.json）
  const ignoredIds = new Set(ctx.report.ignoredReturnedFields.map((f) => f.fieldId))

  for (const r of result.results) {
    if (r.status !== 'diff-produced' || !r.patchRelPath) {
      checks.push({ name: 'apply-check', outcome: 'skipped', detail: 'no diff produced for this task' })
      continue
    }
    const patchAbs = join(ctx.projectRoot, r.patchRelPath)
    const g1 = await checkGit(patchAbs, ctx.projectRoot)
    const g1Detail = g1 === 'pass' ? undefined : g1 === 'skipped' ? 'not a git repository (R10)' : 'git apply --check failed (E7)'
    checks.push({ name: 'apply-check', outcome: g1, ...(g1Detail ? { detail: g1Detail } : {}) })
    if (g1 === 'reject') { verdict = 'reject'; continue }

    const lines = addedLines(r.diffText ?? '')
    // G2：ignored-render（D3）
    for (const line of lines) {
      for (const m of line.matchAll(DATA_MK_FIELD)) {
        const id = m[1]
        if (id && ignoredIds.has(id)) {
          reject('ignored-render', `data-mk-field="${id}" points at an ignored field (D3)`)
        }
      }
    }
    // G3：json-dump（同行或邻近 ±2 行含 response/res./data 上下文特征，R5）
    lines.forEach((line, i) => {
      if (!JSON_STRINGIFY.test(line)) return
      const window = lines.slice(Math.max(0, i - 2), i + 3)
      if (window.some((l) => RESPONSE_CONTEXT.test(l))) {
        reject('json-dump', 'JSON.stringify dump of response-like data used as UI content (R5)')
      }
    })
    // G4：console-probe（R5）
    for (const line of lines) {
      if (CONSOLE_LOG.test(line) && FIELD_WORD.test(line)) {
        reject('console-probe', 'console.log probe mentioning field/coverage (R5)')
      }
    }
  }
  return { verdict, checks }
}

export function createReviewAgent(): CoverageAgentPlugin {
  return defineCoverageAgent({
    name: 'review-agent',
    version: '0.1.0',
    capabilities: ['verify'],
    plan: async () => ({ tasks: [] }),
    apply: async () => ({ results: [] }),
    verify: verifyDiff,
  })
}
```

- [ ] **Step 4: index.ts 追加出口**

```ts
export {
  addedLines,
  verifyDiff,
  createReviewAgent,
  type ApplyCheckFn,
} from './agents/review.js'
```

- [ ] **Step 5: 跑测试确认通过 + typecheck + commit**

Run: `npx vitest run packages/agent/src/__tests__/review.test.ts`
Expected: PASS（10 tests）
Run: `corepack pnpm -F @nx-mk/agent typecheck`
Expected: 无错误

```bash
git add packages/agent
git commit -m "feat(agent): review-agent 静态 guard（G1 apply-check + G2-G4 启发式）"
```

---

### Task 5: api-ui-agent（plan 任务渲染 + apply prompt 组装）

**Files:**
- Create: `packages/agent/src/agents/api-ui.ts`
- Modify: `packages/agent/src/index.ts`（追加 re-export）
- Test: `packages/agent/src/__tests__/api-ui.test.ts`

**Interfaces:**
- Consumes: `KernelError`（kernel）、`defineCoverageAgent` / `AgentContext` / `AgentPlan` / `AgentApplyResult` / `AgentTask` / `CoverageAgentPlugin`（Task 1）。
- Produces（T7 消费）:
  - `planTasks(ctx: AgentContext): Promise<AgentPlan>`（report.missingRequiredFields 全量渲染，无状态 —— PLN-1）
  - `buildPrompt(task: AgentTask, ctx: AgentContext): string`（§44.4 约束 + 字段上下文 + 输出格式指令）
  - `applyTasks(ctx: AgentContext, plan: AgentPlan): Promise<AgentApplyResult>`（逐 task 调 `ctx.ai.edit`；`PROVIDER_UNAVAILABLE` 上抛（E4），其余 → failed（E5/E6））
  - `createApiUiAgent(): CoverageAgentPlugin`（name=`api-ui-agent`）

- [ ] **Step 1: 写失败测试**

`packages/agent/src/__tests__/api-ui.test.ts`：

```ts
/**
 * api-ui-agent 单测（spec §3.4/§3.5 + plan §44.4）：plan 渲染、prompt 约束、apply 错误分级。
 */
import { describe, it, expect } from 'vitest'
import { KernelError } from '@nx-mk/kernel'
import { buildPrompt, createApiUiAgent, planTasks } from '../agents/api-ui.js'
import type { AgentContext, AgentProvider, CoverageReport } from '../types.js'

function makeReport(): CoverageReport {
  return {
    runId: 'run_x',
    metrics: {
      requiredCoverage: 0.5, effectiveCoverage: 0.5, rawBackendFieldCoverage: 0.5,
      endpointsTotal: 0, endpointsCalled: 0, fieldsTotal: 0, fieldsReturned: 0,
      requiredFields: 0, missingRequiredFields: 0, ignoredReturnedFields: 0, suspiciousFields: 0,
    },
    missingRequiredFields: [
      { fieldId: 'GET /users.200.data.name', fieldPath: 'data.name', endpointId: 'getUsers', state: 'missing', policyStatus: 'required' },
      { fieldId: 'POST /orders.200.data.sku', fieldPath: 'data.sku', state: 'missing', policyStatus: 'required' },
    ],
    weakEvidenceFields: [], ignoredReturnedFields: [], suspiciousCoverage: [], endpoints: [], requests: [],
  }
}

function makeCtx(provider?: AgentProvider): AgentContext {
  return {
    report: makeReport(),
    manifestSummary: 'Manifest endpoints:\n- GET /users (called=true, fields 1/2)',
    policySummary: 'Policy summary: test',
    projectRoot: '/proj',
    ai: provider ?? { name: 'fake', edit: async () => ({ diffText: 'DIFF' }) },
    log: () => {},
  }
}

describe('planTasks', () => {
  it('renders every missingRequiredField as a render-field task (endpointId ?? null)', async () => {
    const plan = await planTasks(makeCtx())
    expect(plan.tasks).toHaveLength(2)
    expect(plan.tasks[0]).toEqual({
      type: 'render-field',
      fieldId: 'GET /users.200.data.name',
      fieldPath: 'data.name',
      endpointId: 'getUsers',
      reason: expect.stringContaining('missing'),
    })
    expect(plan.tasks[1]?.endpointId).toBeNull()
  })
})

describe('buildPrompt', () => {
  it('contains the §44.4 constraints, field context and diff-only output instruction', () => {
    const ctx = makeCtx()
    const p = buildPrompt(ctx.report.missingRequiredFields[0]!, ctx)
    expect(p).toContain('data.name')
    expect(p).toContain('getUsers')
    expect(p).toContain('data-mk-field="GET /users.200.data.name"')
    expect(p).toContain('Never render fields that the policy marks as ignored')
    expect(p).toContain('Never dump a response object with JSON.stringify')
    expect(p).toContain('Never add console.log probes')
    expect(p).toContain(ctx.manifestSummary)
    expect(p).toContain('unified diff')
  })
})

describe('applyTasks', () => {
  it('returns diff-produced per task on provider success', async () => {
    const ctx = makeCtx()
    const applied = await createApiUiAgent().apply(ctx, { tasks: ctx.report.missingRequiredFields.map((f) => ({ type: 'render-field', fieldId: f.fieldId, fieldPath: f.fieldPath, endpointId: f.endpointId ?? null, reason: 'missing' })) })
    expect(applied.results).toHaveLength(2)
    expect(applied.results.every((r) => r.status === 'diff-produced' && r.diffText === 'DIFF')).toBe(true)
  })

  it('converts provider failures to failed results (E5/E6)', async () => {
    const ctx = makeCtx({ name: 'fake', edit: async () => { throw new Error('no diff block found') } })
    const applied = await createApiUiAgent().apply(ctx, { tasks: [{ type: 'render-field', fieldId: 'f1', fieldPath: 'd', endpointId: null, reason: 'r' }] })
    expect(applied.results[0]?.status).toBe('failed')
    expect(applied.results[0]?.error).toContain('no diff')
  })

  it('propagates PROVIDER_UNAVAILABLE as process-level (E4)', async () => {
    const ctx = makeCtx({ name: 'fake', edit: async () => { throw new KernelError('PROVIDER_UNAVAILABLE', 'claude not found') } })
    await expect(createApiUiAgent().apply(ctx, { tasks: [{ type: 'render-field', fieldId: 'f1', fieldPath: 'd', endpointId: null, reason: 'r' }] }))
      .rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/agent/src/__tests__/api-ui.test.ts`
Expected: FAIL（`../agents/api-ui.js` 不存在）

- [ ] **Step 3: 实现 agents/api-ui.ts**

```ts
/**
 * api-ui-agent（spec §3.4/§3.5 + plan §44.4）—— plan 全量渲染缺失字段为任务；
 * apply 逐 task 组 prompt 调 provider.edit。
 * 无状态（PLN-1）：R6/R7 的尝试状态机与批次切片在 runtime。
 * E4：PROVIDER_UNAVAILABLE 上抛（进程级）；其余 provider 失败 → task failed（E5/E6）。
 */
import { KernelError } from '@nx-mk/kernel'
import {
  defineCoverageAgent,
  type AgentApplyResult,
  type AgentContext,
  type AgentPlan,
  type AgentTask,
  type CoverageAgentPlugin,
  type TaskApplyResult,
} from '../types.js'

// plan：report.missingRequiredFields 全量渲染（endpointId 缺省 → null）
export async function planTasks(ctx: AgentContext): Promise<AgentPlan> {
  return {
    tasks: ctx.report.missingRequiredFields.map((f) => ({
      type: 'render-field' as const,
      fieldId: f.fieldId,
      fieldPath: f.fieldPath,
      endpointId: f.endpointId ?? null,
      reason: `missing required field (state=${f.state}, policyStatus=${f.policyStatus})`,
    })),
  }
}

// prompt 组装（spec §3.5）：§44.4 硬约束 + 字段上下文 + manifestSummary + 输出格式指令
export function buildPrompt(task: AgentTask, ctx: AgentContext): string {
  const endpoint = task.endpointId ?? 'unknown endpoint'
  return [
    'You are improving API/UI coverage of a frontend project.',
    `Task: make the API field "${task.fieldPath}" (endpoint: ${endpoint}) visibly rendered in the UI, so the coverage analyzer can observe real evidence.`,
    '',
    'Hard constraints:',
    '- Never render fields that the policy marks as ignored.',
    '- Never dump a response object with JSON.stringify as a substitute for real UI rendering.',
    '- Never add console.log probes for fields or coverage.',
    `- Add data-mk-field="${task.fieldId}" to the element(s) that render the field, so evidence collection can observe it.`,
    '',
    ctx.manifestSummary,
    '',
    'Output exactly one fenced ```diff code block containing a unified diff (git format). No explanations outside the block.',
  ].join('\n')
}

export async function applyTasks(ctx: AgentContext, plan: AgentPlan): Promise<AgentApplyResult> {
  const results: TaskApplyResult[] = []
  for (const task of plan.tasks) {
    try {
      const out = await ctx.ai.edit({
        instructions: buildPrompt(task, ctx),
        context: {
          fieldId: task.fieldId,
          fieldPath: task.fieldPath,
          endpointId: task.endpointId ?? 'unknown',
          reason: task.reason,
        },
      })
      results.push({ task, status: 'diff-produced', diffText: out.diffText })
    } catch (err) {
      if (err instanceof KernelError && err.code === 'PROVIDER_UNAVAILABLE') throw err // E4 进程级
      results.push({ task, status: 'failed', error: err instanceof Error ? err.message : String(err) })
    }
  }
  return { results }
}

export function createApiUiAgent(): CoverageAgentPlugin {
  return defineCoverageAgent({
    name: 'api-ui-agent',
    version: '0.1.0',
    capabilities: ['plan', 'apply'],
    plan: planTasks,
    apply: applyTasks,
  })
}
```

- [ ] **Step 4: index.ts 追加出口**

```ts
export {
  planTasks,
  buildPrompt,
  applyTasks,
  createApiUiAgent,
} from './agents/api-ui.js'
```

- [ ] **Step 5: 跑测试确认通过 + typecheck + commit**

Run: `npx vitest run packages/agent/src/__tests__/api-ui.test.ts`
Expected: PASS（5 tests）
Run: `corepack pnpm -F @nx-mk/agent typecheck`
Expected: 无错误

```bash
git add packages/agent
git commit -m "feat(agent): api-ui-agent —— plan 任务渲染 + apply prompt 组装（§44.4 约束）"
```

---

### Task 6: config `agent:` 段 + kernel/loader subcommand 接线

**Files:**
- Modify: `packages/config/src/schema.ts`（dashboard schema 后追加三 schema + ConfigSchema.agent）
- Modify: `packages/config/src/loader.ts:55`（subcommand 联合 + `'loop'`）
- Modify: `packages/kernel/src/types.ts:107`（ResolvedConfig.subcommand + `'loop'`）
- Test: `packages/config/src/__tests__/agent-schema.test.ts`（新）

**Interfaces:**
- Consumes: zod（config 包既有依赖）、`KernelError`（loader 既有）。
- Produces（T7/T8 消费）:
  - `AgentProviderConfigSchema` / `AgentLoopConfigSchema` / `AgentConfigSchema`（zod）+ 导出类型 `AgentProviderConfig` / `AgentLoopConfig` / `AgentConfig`（z.infer）— from `@nx-mk/config`
  - `loadConfig` 接受 `subcommand: 'loop'`
  - kernel `ResolvedConfig.subcommand` 联合含 `'loop'`（纯类型，编译期生效）

- [ ] **Step 1: 写失败测试**

`packages/config/src/__tests__/agent-schema.test.ts`：

```ts
/**
 * agent 配置段单测（spec §3.8 / E3）：全 optional、type 字面量收口、loader 接受 loop 子命令。
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { ConfigSchema } from '../schema.js'
import { loadConfig } from '../loader.js'
import { makeRunId } from '@nx-mk/kernel'

describe('AgentConfigSchema (spec §3.8)', () => {
  it('parses a full agent section', () => {
    const r = ConfigSchema.safeParse({
      agent: {
        provider: { type: 'claude-code', timeoutMs: 1000, maxTurns: 4 },
        loop: { maxIterations: 2, stopIfNoImprovementRounds: 1, maxTasksPerIteration: 3 },
      },
    })
    expect(r.success).toBe(true)
  })

  it('is optional — absent agent section parses fine', () => {
    expect(ConfigSchema.safeParse({}).success).toBe(true)
  })

  it('rejects provider.type other than claude-code (E3 → CONFIG_INVALID)', () => {
    const r = ConfigSchema.safeParse({ agent: { provider: { type: 'openai' } } })
    expect(r.success).toBe(false)
  })

  it('rejects non-positive numbers', () => {
    expect(ConfigSchema.safeParse({ agent: { loop: { maxIterations: 0 } } }).success).toBe(false)
    expect(ConfigSchema.safeParse({ agent: { provider: { type: 'claude-code', timeoutMs: -1 } } }).success).toBe(false)
  })
})

describe('loadConfig with subcommand loop', () => {
  it('accepts the loop subcommand and echoes it', async () => {
    const path = joinFixture()
    const cfg = await loadConfig({ path, cwd: process.cwd(), runId: makeRunId('loop'), subcommand: 'loop' })
    expect(cfg.subcommand).toBe('loop')
  })
})

// 最小合法配置文件（YAML 注释解析为 null，ConfigSchema 会拒 —— 必须有真实字段）
function joinFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nx-mk-agent-cfg-'))
  const path = join(dir, 'nx-mk.config.yml')
  writeFileSync(path, 'openapi: ./swagger.json\n', 'utf8')
  return path
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/config/src/__tests__/agent-schema.test.ts`
Expected: FAIL（`subcommand: 'loop'` 类型错误 / agent 段 schema 不存在）

- [ ] **Step 3: 实现 schema.ts + loader.ts + kernel types.ts**

`packages/config/src/schema.ts` —— 在 `DashboardConfigSchema`（及其类型导出）之后追加：

```ts
// Phase 5（spec §3.8）：agent 段 —— provider（唯一 claude-code，E3）+ loop 两小节；
// 全部 optional：默认值由 @nx-mk/agent runtime 回填（AGENT_DEFAULTS），config 层不设默认
export const AgentProviderConfigSchema = z.object({
  type: z.literal('claude-code'),
  timeoutMs: z.number().int().positive().optional(),
  maxTurns: z.number().int().positive().optional(),
})
export type AgentProviderConfig = z.infer<typeof AgentProviderConfigSchema>

export const AgentLoopConfigSchema = z.object({
  maxIterations: z.number().int().positive().optional(),
  stopIfNoImprovementRounds: z.number().int().positive().optional(),
  maxTasksPerIteration: z.number().int().positive().optional(),
})
export type AgentLoopConfig = z.infer<typeof AgentLoopConfigSchema>

export const AgentConfigSchema = z.object({
  provider: AgentProviderConfigSchema.optional(),
  loop: AgentLoopConfigSchema.optional(),
})
export type AgentConfig = z.infer<typeof AgentConfigSchema>
```

同文件 `ConfigSchema` 的 `dashboard: DashboardConfigSchema.optional(),` 之后追加：

```ts
    // Phase 5：可选 agent 段（spec §3.8 —— loop 命令消费 provider/loop 两小节）
    agent: AgentConfigSchema.optional(),
```

`packages/config/src/loader.ts:55` —— `LoadConfigInput.subcommand` 联合扩展：

```ts
  subcommand: 'run' | 'init' | 'doctor' | 'start' | 'loop'
```

`packages/kernel/src/types.ts:107` —— `ResolvedConfig.subcommand` 联合扩展：

```ts
  subcommand: 'run' | 'init' | 'doctor' | 'start' | 'loop'
```

- [ ] **Step 4: 跑测试确认通过 + 全量回归 + commit**

Run: `npx vitest run packages/config packages/kernel`
Expected: 新测试 PASS；config/kernel 既有测试 PASS（subcommand 扩展纯增量）
Run: `corepack pnpm -F @nx-mk/config typecheck && corepack pnpm -F @nx-mk/kernel typecheck`
Expected: 无错误

```bash
git add packages/config packages/kernel
git commit -m "feat(config,kernel): agent 配置段（provider/loop）+ loop 子命令联合三处接线"
```

---

### Task 7: runAgentLoop —— 批次/轮次/终止/审计

**Files:**
- Create: `packages/agent/src/runtime.ts`
- Modify: `packages/agent/src/index.ts`（追加 re-export）
- Test: `packages/agent/src/__tests__/runtime-loop.test.ts`、`packages/agent/src/__tests__/runtime-terminate.test.ts`

**Interfaces:**
- Consumes: `openCoverageDb` / `CoverageDb` / `CoverageReport`（`@nx-mk/coverage`）、`writePatchFile` / `toPosixRel` / `sanitizeFieldSlug`（Task 2）、全部协议类型（Task 1）。
  - **实现前必读**：`packages/coverage/src/db/schema.ts` 的 `agent_iterations` DDL（约 line 127）—— `persistIteration` 的 INSERT 列名必须与 DDL 逐字一致；若发现列名与本计划不同，以 DDL 为准并在报告中注明。
- Produces（T8 消费）:
  - `AGENT_DEFAULTS`（`{ provider: { timeoutMs: 300000, maxTurns: 8 }, loop: { maxIterations: 5, stopIfNoImprovementRounds: 2, maxTasksPerIteration: 5 } }`）
  - `resolveAgentConfig(config: AgentConfig | undefined): ResolvedAgentConfig`
  - `makeAgentRunId(now?: Date): string`（`agent_YYYYMMDD_HHMMSS_<4位随机>`）
  - `renderManifestSummary(report) / renderPolicySummary(report)`（R8）
  - `runAgentLoop(opts: LoopOptions, deps: LoopDeps): Promise<LoopSummary>`（spec §3.4 逐字签名；`LoopOptions = { projectRoot, report, config: AgentConfig, log? }`，`LoopDeps = { provider, apiUiAgent, reviewAgent }`，`LoopSummary = { agentRunId, iterations, produced, rejected, failed, givenUp, patchDir, stoppedBy }`）

- [ ] **Step 1: 写失败测试（runtime-loop.test.ts）**

`packages/agent/src/__tests__/runtime-loop.test.ts`：

```ts
/**
 * runtime 全链单测（spec §5 runtime 集成行）：scripted provider + 真 api-ui-agent +
 * scripted review-agent；真实 sqlite（临时目录共享库）+ 真实落盘。
 * 断言面：LoopSummary 计数 / patches 布局 / runs+agent_iterations 行（R3/R4/R6/R7）。
 */
import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { openCoverageDb } from '@nx-mk/coverage'
import { runAgentLoop } from '../runtime.js'
import { createApiUiAgent } from '../agents/api-ui.js'
import type { AgentProvider, AgentTask, AgentVerifyResult, CoverageAgentPlugin, CoverageReport } from '../types.js'

export function makeReport(missing: number, ignoredIds: string[] = []): CoverageReport {
  return {
    runId: 'run_base',
    metrics: {
      requiredCoverage: 0.4, effectiveCoverage: 0.4, rawBackendFieldCoverage: 0.4,
      endpointsTotal: 1, endpointsCalled: 1, fieldsTotal: missing, fieldsReturned: missing,
      requiredFields: missing, missingRequiredFields: missing,
      ignoredReturnedFields: ignoredIds.length, suspiciousFields: 0,
    },
    missingRequiredFields: Array.from({ length: missing }, (_, i) => ({
      fieldId: `field_${i}`, fieldPath: `data.f${i}`, endpointId: 'getUsers',
      state: 'missing' as const, policyStatus: 'required' as const,
    })),
    weakEvidenceFields: [],
    ignoredReturnedFields: ignoredIds.map((id) => ({ fieldId: id, fieldPath: id, state: 'ignored' as const, policyStatus: 'ignored' as const })),
    suspiciousCoverage: [],
    endpoints: [{ endpointId: 'getUsers', method: 'GET', path: '/users', called: true, fieldsTotal: missing, fieldsCovered: 0 }],
    requests: [],
  }
}

export const OK_PROVIDER: AgentProvider = { name: 'fake', edit: async () => ({ diffText: '--- a\n+++ b\n@@ -1 +1 @@\n-a\n+b' }) }

// 可编程 verdict 的 review-agent 替身：按 fieldId 前缀决定 pass/reject
export function scriptedReview(rule: (task: AgentTask) => 'pass' | 'reject'): CoverageAgentPlugin {
  return {
    name: 'scripted-review', version: '0.0.1', capabilities: ['verify'],
    plan: async () => ({ tasks: [] }),
    apply: async () => ({ results: [] }),
    verify: async (_ctx, result): Promise<AgentVerifyResult> => {
      const r = result.results[0]
      const verdict = r && rule(r.task) === 'reject' ? 'reject' : 'pass'
      return { verdict, checks: [{ name: 'scripted', outcome: verdict === 'pass' ? 'pass' : 'reject' }] }
    },
  }
}

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'nx-mk-runtime-'))
}

async function readIterations(root: string, agentRunId: string) {
  const db = openCoverageDb(join(root, '.nx-mk', 'coverage.db'))
  const rows = db.prepare('SELECT * FROM agent_iterations WHERE run_id = ? ORDER BY id').all(agentRunId) as Record<string, unknown>[]
  const runs = db.prepare('SELECT * FROM runs WHERE id = ?').all(agentRunId) as Record<string, unknown>[]
  db.close()
  return { rows, runs }
}

describe('runAgentLoop — progression to backlog-empty (R6/R7)', () => {
  it('batches 6 fields 2-per-iteration, all produced, then stops', async () => {
    const root = makeProject()
    const summary = await runAgentLoop(
      { projectRoot: root, report: makeReport(6), config: { loop: { maxTasksPerIteration: 2, maxIterations: 5 } } },
      { provider: OK_PROVIDER, apiUiAgent: createApiUiAgent(), reviewAgent: scriptedReview(() => 'pass') },
    )
    expect(summary.stoppedBy).toBe('backlog-empty')
    expect(summary.iterations).toBe(3)
    expect(summary.produced).toBe(6)
    expect(summary.rejected).toBe(0)
    expect(summary.givenUp).toBe(0)
    expect(summary.patchDir).toBe(`.nx-mk/patches/${summary.agentRunId}`)
    // patches 布局：3 轮 × 2 个，全部在终稿目录
    const patchDir = join(root, '.nx-mk', 'patches', summary.agentRunId)
    expect(readdirSync(patchDir).filter((f) => f.endsWith('.patch'))).toHaveLength(6)
    // R4：空 run 目录（dashboard 目录扫描可见）+ runs 行 status='agent-loop' → 'completed'
    expect(existsSync(join(root, '.nx-mk', 'runs', summary.agentRunId))).toBe(true)
    const { rows, runs } = await readIterations(root, summary.agentRunId)
    expect(runs).toHaveLength(1)
    expect(runs[0]?.status).toBe('completed')
    expect(rows).toHaveLength(6)
    expect(rows.every((r) => r.status === 'produced')).toBe(true)
    // R3：before_coverage=0.4、after_coverage=NULL
    expect(rows[0]?.before_coverage).toBeCloseTo(0.4)
    expect(rows.every((r) => r.after_coverage === null)).toBe(true)
    expect(rows[0]?.diff_path).toContain('.nx-mk/patches/')
  })
})

describe('runAgentLoop — retry machine (R6, PLN-5)', () => {
  it('a permanently-rejected field: first attempt rejected, retry given-up, patch archived', async () => {
    const root = makeProject()
    const summary = await runAgentLoop(
      { projectRoot: root, report: makeReport(1), config: {} },
      { provider: OK_PROVIDER, apiUiAgent: createApiUiAgent(), reviewAgent: scriptedReview(() => 'reject') },
    )
    expect(summary.stoppedBy).toBe('no-improvement') // stopIfNoImprovementRounds=2 默认
    expect(summary.rejected).toBe(1)
    expect(summary.givenUp).toBe(1)
    expect(summary.iterations).toBe(2)
    // reject 留档：终稿目录无 patch，rejected/ 有
    const patchDir = join(root, '.nx-mk', 'patches', summary.agentRunId)
    expect(readdirSync(patchDir).filter((f) => f.endsWith('.patch'))).toHaveLength(0)
    expect(readdirSync(join(patchDir, 'rejected'))).toHaveLength(2)
    const { rows } = await readIterations(root, summary.agentRunId)
    expect(rows.map((r) => r.status)).toEqual(['rejected', 'given-up'])
  })

  it('a produced field is never retried; other fields still progress', async () => {
    const root = makeProject()
    // field_0 恒 reject；其余 pass
    const summary = await runAgentLoop(
      { projectRoot: root, report: makeReport(3), config: { loop: { maxTasksPerIteration: 2, maxIterations: 5 } } },
      { provider: OK_PROVIDER, apiUiAgent: createApiUiAgent(), reviewAgent: scriptedReview((t) => (t.fieldId === 'field_0' ? 'reject' : 'pass')) },
    )
    expect(summary.produced).toBe(2)
    expect(summary.givenUp).toBe(1)
    expect(summary.stoppedBy).toBe('backlog-empty')
    const { rows } = await readIterations(root, summary.agentRunId)
    // field_0 恰好两行（rejected + given-up），其余各一行 produced
    // （runtime 把 fieldId 写进 summary 列前缀，可按字段归因）
    expect(rows.filter((r) => String(r.summary).startsWith('field_0'))).toHaveLength(2)
    expect(rows.filter((r) => r.status === 'produced')).toHaveLength(2)
    expect(rows).toHaveLength(4)
  })
})
```

- [ ] **Step 2: 写失败测试（runtime-terminate.test.ts）**

`packages/agent/src/__tests__/runtime-terminate.test.ts`：

```ts
/**
 * 终止判定单测（spec §3.2 步 6 / §38）：max-iterations / no-improvement / E4 上抛。
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { KernelError } from '@nx-mk/kernel'
import { runAgentLoop } from '../runtime.js'
import { createApiUiAgent } from '../agents/api-ui.js'
import type { AgentProvider } from '../types.js'
import { makeReport, OK_PROVIDER, scriptedReview } from './runtime-loop.test.js'

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'nx-mk-terminate-'))
}

describe('termination', () => {
  it('stops at maxIterations when backlog remains', async () => {
    const root = makeProject()
    const summary = await runAgentLoop(
      { projectRoot: root, report: makeReport(5), config: { loop: { maxIterations: 1, maxTasksPerIteration: 2 } } },
      { provider: OK_PROVIDER, apiUiAgent: createApiUiAgent(), reviewAgent: scriptedReview(() => 'pass') },
    )
    expect(summary.stoppedBy).toBe('max-iterations')
    expect(summary.iterations).toBe(1)
    expect(summary.produced).toBe(2) // 只跑了第一批
  })

  it('stops after stopIfNoImprovementRounds consecutive zero-produced rounds', async () => {
    const root = makeProject()
    const summary = await runAgentLoop(
      { projectRoot: root, report: makeReport(4), config: { loop: { maxTasksPerIteration: 2, stopIfNoImprovementRounds: 2 } } },
      { provider: OK_PROVIDER, apiUiAgent: createApiUiAgent(), reviewAgent: scriptedReview(() => 'reject') },
    )
    // iter1: f0,f1 rejected；iter2: f0,f1 given-up → 连续 2 轮零 produced → 提前终止（f2/f3 未触达）
    expect(summary.stoppedBy).toBe('no-improvement')
    expect(summary.iterations).toBe(2)
    expect(summary.produced).toBe(0)
    expect(summary.rejected).toBe(2)
    expect(summary.givenUp).toBe(2)
  })

  it('provider task failures also count as no-improvement rounds (E5)', async () => {
    const root = makeProject()
    const failing: AgentProvider = { name: 'fake', edit: async () => { throw new Error('claude exited with code 1') } }
    const summary = await runAgentLoop(
      { projectRoot: root, report: makeReport(1), config: {} },
      { provider: failing, apiUiAgent: createApiUiAgent(), reviewAgent: scriptedReview(() => 'pass') },
    )
    expect(summary.failed).toBe(1)
    expect(summary.givenUp).toBe(1)
    expect(summary.stoppedBy).toBe('no-improvement')
  })

  it('propagates PROVIDER_UNAVAILABLE and marks the runs row failed (E4)', async () => {
    const root = makeProject()
    const enoent = Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' })
    const failing: AgentProvider = { name: 'fake', edit: async () => { throw enoent } }
    await expect(runAgentLoop(
      { projectRoot: root, report: makeReport(1), config: {} },
      { provider: failing, apiUiAgent: createApiUiAgent(), reviewAgent: scriptedReview(() => 'pass') },
    )).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })
    const db = openCoverageDb(join(root, '.nx-mk', 'coverage.db'))
    const runs = db.prepare('SELECT * FROM agent_iterations').all()
    db.close()
    expect(runs).toHaveLength(0) // 首个 task 尚未落库即上抛
  })
})

```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run packages/agent/src/__tests__/runtime-loop.test.ts packages/agent/src/__tests__/runtime-terminate.test.ts`
Expected: FAIL（`../runtime.js` 不存在）

- [ ] **Step 4: 实现 runtime.ts**

```ts
/**
 * Agent Runtime（spec §3.2/§3.4）—— runAgentLoop 编排：
 * 批次（R7）→ provider 产 diff → 落盘终稿（PLN-2）→ review guard →
 * reject 留档 rename → agent_iterations 落库（R3/R4/PLN-5）→ 终止判定（R6/§38）。
 * provider/agent 均由 LoopDeps 注入（Phase 4 StartDeps 同风格），runtime 不感知 spawn。
 */
import { mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { KernelError } from '@nx-mk/kernel'
import { openCoverageDb, type CoverageDb, type CoverageReport } from '@nx-mk/coverage'
import { sanitizeFieldSlug, toPosixRel, writePatchFile } from './patches.js'
import type {
  AgentConfig, AgentContext, AgentTask, CoverageAgentPlugin,
  LoopDeps, LoopOptions, LoopSummary, TaskApplyResult,
} from './types.js'

// 默认值（spec §3.8：§38 逐字 + provider 默认；CLI 装配层也复用 provider 项）
export const AGENT_DEFAULTS = {
  provider: { timeoutMs: 300_000, maxTurns: 8 },
  loop: { maxIterations: 5, stopIfNoImprovementRounds: 2, maxTasksPerIteration: 5 },
} as const

export interface ResolvedAgentConfig {
  maxIterations: number
  stopIfNoImprovementRounds: number
  maxTasksPerIteration: number
}

// config.agent 原始可选段 → 补全默认值
export function resolveAgentConfig(config: AgentConfig | undefined): ResolvedAgentConfig {
  return {
    maxIterations: config?.loop?.maxIterations ?? AGENT_DEFAULTS.loop.maxIterations,
    stopIfNoImprovementRounds: config?.loop?.stopIfNoImprovementRounds ?? AGENT_DEFAULTS.loop.stopIfNoImprovementRounds,
    maxTasksPerIteration: config?.loop?.maxTasksPerIteration ?? AGENT_DEFAULTS.loop.maxTasksPerIteration,
  }
}

// agentRunId：agent_YYYYMMDD_HHMMSS_<4位随机>（同秒多次执行不撞目录；目录名安全）
export function makeAgentRunId(now = new Date()): string {
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const HH = String(now.getHours()).padStart(2, '0')
  const MM = String(now.getMinutes()).padStart(2, '0')
  const SS = String(now.getSeconds()).padStart(2, '0')
  const rand = Math.random().toString(36).slice(2, 6)
  return `agent_${yyyy}${mm}${dd}_${HH}${MM}${SS}_${rand}`
}

// R8：manifestSummary / policySummary 由 CoverageReport 派生（不读 manifest.json）
export function renderManifestSummary(report: CoverageReport): string {
  const lines = report.endpoints.map(
    (e) => `- ${e.method} ${e.path} (called=${e.called}, fields ${e.fieldsCovered}/${e.fieldsTotal})`,
  )
  return ['Manifest endpoints:', ...(lines.length > 0 ? lines : ['- (no endpoints)'])].join('\n')
}

export function renderPolicySummary(report: CoverageReport): string {
  return [
    `Policy summary: requiredCoverage=${report.metrics.requiredCoverage}, missingRequired=${report.metrics.missingRequiredFields}, ignoredReturned=${report.metrics.ignoredReturnedFields}.`,
    'Never render fields from the ignored set.',
  ].join('\n')
}

// 跨轮尝试状态（R6）：一个 fieldId 至多两次尝试；produced / 二次失败即 done
interface AttemptState { tries: number; done: 'produced' | 'given-up' | null }

// agent_iterations 逐 task 一行（spec §3.7；status 枚举 PLN-5）
interface IterationRow {
  id: string
  runId: string
  iteration: number
  status: 'produced' | 'rejected' | 'failed' | 'given-up'
  summary: string
  beforeCoverage: number
  diffPath: string | null
}

// INSERT 列名以 packages/coverage/src/db/schema.ts 的 agent_iterations DDL 为准（实现前核对）
function persistIteration(db: CoverageDb, row: IterationRow): void {
  db.prepare(
    `INSERT INTO agent_iterations (id, run_id, iteration, status, summary, before_coverage, after_coverage, diff_path, started_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
  ).run(
    row.id, row.runId, row.iteration, row.status, row.summary,
    row.beforeCoverage, row.diffPath,
    new Date().toISOString(), new Date().toISOString(),
  )
}

export async function runAgentLoop(opts: LoopOptions, deps: LoopDeps): Promise<LoopSummary> {
  const log = opts.log ?? (() => {})
  const cfg = resolveAgentConfig(opts.config)
  const agentRunId = makeAgentRunId()
  const nxMkDir = join(opts.projectRoot, '.nx-mk')

  // E9（PLN-9）：产物目录 / 共享库准备失败 → KERNEL_INTERNAL（退出码 5）
  const failInternal = (scope: string, err: unknown): KernelError =>
    err instanceof KernelError ? err : new KernelError('KERNEL_INTERNAL', `failed to prepare ${scope} under ${nxMkDir}`, err)

  let patchDir: string
  let rejectedDir: string
  let db: CoverageDb
  let beforeCoverage: number
  try {
    // R4：共享库 + 空运行目录（dashboard 目录扫描可见）
    mkdirSync(join(nxMkDir, 'runs', agentRunId), { recursive: true })
    patchDir = join(nxMkDir, 'patches', agentRunId)
    rejectedDir = join(patchDir, 'rejected')
    mkdirSync(rejectedDir, { recursive: true })
    db = openCoverageDb(join(nxMkDir, 'coverage.db'))
    // E10：共享库并发写保护；超时仍败才抛
    db.pragma('busy_timeout = 2000')
    beforeCoverage = opts.report.metrics.requiredCoverage
    db.insertRun(agentRunId, new Date().toISOString(), 'agent-loop')
  } catch (err) {
    throw failInternal('.nx-mk artifacts', err)
  }

  const ctx: AgentContext = {
    report: opts.report,
    manifestSummary: renderManifestSummary(opts.report),
    policySummary: renderPolicySummary(opts.report),
    projectRoot: opts.projectRoot,
    ai: deps.provider,
    log,
  }

  const attempts = new Map<string, AttemptState>()
  let produced = 0
  let rejected = 0
  let failed = 0
  let givenUp = 0
  let iterations = 0
  let noImprovementRounds = 0
  let stoppedBy: LoopSummary['stoppedBy'] = 'max-iterations'

  try {
    // PLN-1：plan 渲染全量待办；切片与重试判定在 runtime
    const backlog: AgentTask[] = (await deps.apiUiAgent.plan(ctx)).tasks

    while (true) {
      // R7：每轮取待办切片（R6：produced / given-up 除外；重试至多一次）
      const batch: AgentTask[] = []
      for (const t of backlog) {
        if (batch.length >= cfg.maxTasksPerIteration) break
        const st = attempts.get(t.fieldId)
        if (st && (st.done !== null || st.tries >= 2)) continue
        batch.push(t)
      }
      if (batch.length === 0) { stoppedBy = 'backlog-empty'; break }
      if (iterations >= cfg.maxIterations) { stoppedBy = 'max-iterations'; break }
      iterations += 1

      const applied = await deps.apiUiAgent.apply(ctx, { tasks: batch })
      let iterProduced = 0

      for (let i = 0; i < applied.results.length; i++) {
        const r: TaskApplyResult = applied.results[i]!
        const st: AttemptState = attempts.get(r.task.fieldId) ?? { tries: 0, done: null }
        st.tries += 1
        attempts.set(r.task.fieldId, st)

        let status: IterationRow['status']
        let summary: string
        let diffPath: string | null = null

        if (r.status === 'failed') {
          // E5/E6：task 级失败，继续其余 task（PLN-5：二次失败即 given-up）
          if (st.tries >= 2) { status = 'given-up'; givenUp += 1 } else { status = 'failed'; failed += 1 }
          summary = `${r.task.fieldId}: ${r.error ?? 'provider failed'}`
        } else {
          // PLN-2：先写终稿路径（G1 需要落盘文件），reject 再 rename 留档
          const slug = sanitizeFieldSlug(r.task.fieldId)
          let abs: string
          try {
            abs = writePatchFile(patchDir, `iter-${iterations}-${slug}.patch`, r.diffText ?? '')
          } catch (err) {
            throw failInternal('patch file', err) // E9
          }
          r.patchRelPath = toPosixRel(abs, opts.projectRoot)
          // PLN-4：逐 task 单结果包装；PLN-6：无 verify 视为 pass
          const vr = (await deps.reviewAgent.verify?.(ctx, { results: [r] })) ?? { verdict: 'pass' as const, checks: [] }
          if (vr.verdict === 'pass') {
            status = 'produced'
            produced += 1
            iterProduced += 1
            st.done = 'produced'
            diffPath = r.patchRelPath
            summary = `${r.task.fieldId}: accepted`
          } else {
            try {
              renameSync(abs, join(rejectedDir, `iter-${iterations}-${slug}.patch`))
            } catch (err) {
              throw failInternal('rejected archive', err) // E9
            }
            if (st.tries >= 2) { status = 'given-up'; givenUp += 1 } else { status = 'rejected'; rejected += 1 }
            const why = vr.checks.filter((c) => c.outcome === 'reject').map((c) => `${c.name}: ${c.detail ?? 'rejected'}`).join('; ')
            summary = `${r.task.fieldId}: ${why}`
          }
        }
        persistIteration(db, {
          id: `ai_${agentRunId}_${iterations}_${i}`, runId: agentRunId, iteration: iterations,
          status, summary, beforeCoverage, diffPath,
        })
        log(`  iter ${iterations} [${i + 1}/${applied.results.length}] ${r.task.fieldId} → ${status}`)
      }

      // §38：连续 stopIfNoImprovementRounds 轮零 produced → 提前终止
      if (iterProduced === 0) {
        noImprovementRounds += 1
        if (noImprovementRounds >= cfg.stopIfNoImprovementRounds) { stoppedBy = 'no-improvement'; break }
      } else {
        noImprovementRounds = 0
      }
    }

    db.endRun(agentRunId, new Date().toISOString(), 'completed')
  } catch (err) {
    db.endRun(agentRunId, new Date().toISOString(), 'failed')
    throw err
  } finally {
    db.close()
  }

  return {
    agentRunId,
    iterations,
    produced,
    rejected,
    failed,
    givenUp,
    patchDir: toPosixRel(patchDir, opts.projectRoot),
    stoppedBy,
  }
}
```

- [ ] **Step 5: index.ts 追加出口**

```ts
export {
  AGENT_DEFAULTS,
  resolveAgentConfig,
  makeAgentRunId,
  renderManifestSummary,
  renderPolicySummary,
  runAgentLoop,
  type ResolvedAgentConfig,
} from './runtime.js'
```

并补充 loop 选项类型出口（`LoopOptions` / `LoopDeps` / `LoopSummary` 定义放 `types.ts` 末尾追加 —— spec §3.4 逐字）：

```ts
// runtime 入口（LoopDeps 为注入缝；claude adapter 在 CLI 装配层构造，runtime 不感知 spawn）
export interface LoopDeps {
  provider: AgentProvider
  apiUiAgent: CoverageAgentPlugin
  reviewAgent: CoverageAgentPlugin    // 其 verify() 即 guard
}
export interface LoopOptions {
  projectRoot: string
  report: CoverageReport
  config: AgentConfig                 // 原始可选段；默认值由 runtime 回填
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
```

（这三个接口加进 `types.ts`，并把 `type LoopDeps` 等加入 index.ts 的 types 出口清单。）

- [ ] **Step 6: 跑测试确认通过 + typecheck + commit**

Run: `npx vitest run packages/agent`
Expected: 全部 PASS（含此前任务的测试；新增约 8 个用例）
Run: `corepack pnpm -F @nx-mk/agent typecheck && corepack pnpm -F @nx-mk/agent build`
Expected: 无错误；tsup 产物含 dist/index.js + index.d.ts

```bash
git add packages/agent
git commit -m "feat(agent): runAgentLoop —— 批次/轮次/终止/审计（R3/R4/R6/R7 + §38 逐字默认）"
```

---

### Task 8: CLI `nx-mk loop`（loopMain + 接线四件套 + RUN_NOT_FOUND）

**Files:**
- Create: `packages/cli/src/commands/loop.ts`
- Modify: `packages/cli/src/index.ts`（Subcommand / ParsedArgs / HELP / parseArgs / main case / import）
- Modify: `packages/cli/package.json`（dependencies + `@nx-mk/agent`）
- Test: `packages/cli/src/__tests__/loop.test.ts`

**Interfaces:**
- Consumes: `loadConfig` / `AgentConfig`（`@nx-mk/config`，Task 6）、`KernelError`（kernel）、`runAgentLoop` / `AGENT_DEFAULTS` / `createClaudeCodeProvider` / `createApiUiAgent` / `createReviewAgent` / `LoopSummary` / `CoverageReport`（`@nx-mk/agent`，Tasks 3/5/7）。
- Produces:
  - `LoopMainOptions = { configPath: string; cwd?: string; maxIterations?: number; cliOverrides?: { logLevel?: LogLevel; outputDir?: string }; deps?: LoopCliDeps }`
  - `LoopCliDeps = { runLoop: typeof runAgentLoop }`（测试缝，对齐 start.ts StartDeps）
  - `loopMain(opts: LoopMainOptions): Promise<void>`（抛 `KernelError('RUN_NOT_FOUND')` / `CONFIG_NOT_FOUND`）

- [ ] **Step 1: 写失败测试**

`packages/cli/src/__tests__/loop.test.ts`：

```ts
/**
 * loop 子命令接线测试（spec §3.9 / E1/E2）：注入 runLoop 替身 —— 不 spawn 真 claude。
 */
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { KernelError } from '@nx-mk/kernel'
import { loopMain, type LoopCliDeps } from '../commands/loop.js'
import type { LoopOptions, LoopSummary } from '@nx-mk/agent'

function makeProject(opts?: { withConfig?: boolean; withReport?: boolean; reportBody?: string }): string {
  const root = mkdtempSync(join(tmpdir(), 'nx-mk-loop-cli-'))
  if (opts?.withConfig !== false) writeFileSync(join(root, 'nx-mk.config.yml'), 'openapi: ./swagger.json\n', 'utf8')
  if (opts?.withReport !== false) {
    const nxMk = join(root, '.nx-mk')
    writeFileSync(
      join(nxMk, 'coverage-report.json'),
      opts?.reportBody ?? JSON.stringify({ runId: 'run_base', metrics: { requiredCoverage: 0.625, effectiveCoverage: 0.625, rawBackendFieldCoverage: 0.625, missingRequiredFields: 2 } }),
    )
  }
  return root
}

function makeDeps(): { deps: LoopCliDeps; calls: LoopOptions[]; summary: LoopSummary } {
  const calls: LoopOptions[] = []
  const summary: LoopSummary = {
    agentRunId: 'agent_20260918_120000_ab12', iterations: 2, produced: 3, rejected: 1, failed: 0, givenUp: 0,
    patchDir: '.nx-mk/patches/agent_20260918_120000_ab12', stoppedBy: 'backlog-empty',
  }
  return { deps: { runLoop: async (opts) => { calls.push(opts); return summary } }, calls, summary }
}

afterEach(() => { vi.restoreAllMocks() })

describe('loopMain', () => {
  it('E2: throws CONFIG_NOT_FOUND when the config file is missing', async () => {
    const root = makeProject({ withConfig: false })
    await expect(loopMain({ configPath: join(root, 'nx-mk.config.yml'), cwd: root, deps: makeDeps().deps }))
      .rejects.toMatchObject({ code: 'CONFIG_NOT_FOUND' })
  })

  it('E1: throws RUN_NOT_FOUND when coverage-report.json is missing', async () => {
    const root = makeProject({ withReport: false })
    const { deps } = makeDeps()
    await expect(loopMain({ configPath: join(root, 'nx-mk.config.yml'), cwd: root, deps }))
      .rejects.toMatchObject({ code: 'RUN_NOT_FOUND' })
  })

  it('E1: throws RUN_NOT_FOUND on a malformed report (shape gate)', async () => {
    const root = makeProject({ reportBody: '{"nope": true}' })
    const { deps } = makeDeps()
    await expect(loopMain({ configPath: join(root, 'nx-mk.config.yml'), cwd: root, deps }))
      .rejects.toMatchObject({ code: 'RUN_NOT_FOUND' })
  })

  it('passes report + defaults into runLoop and prints the summary', async () => {
    const root = makeProject()
    const { deps, calls, summary } = makeDeps()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await loopMain({ configPath: join(root, 'nx-mk.config.yml'), cwd: root, deps })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.projectRoot).toBe(root)
    expect(calls[0]?.report.runId).toBe('run_base')
    expect(calls[0]?.config).toEqual({})
    expect(existsSync(join(root, '.nx-mk'))).toBe(true)
    const printed = log.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(printed).toContain(`Agent loop completed: ${summary.agentRunId}`)
    expect(printed).toContain('produced: 3')
    expect(printed).toContain('stopped by: backlog-empty')
    expect(printed).toContain('requiredCoverage 62.5%')
    expect(printed).toContain(`next: git apply ${summary.patchDir}/*.patch && nx-mk run`)
  })

  it('--max-iterations overrides config.agent.loop.maxIterations', async () => {
    const root = makeProject()
    writeFileSync(join(root, 'nx-mk.config.yml'), 'agent:\n  loop:\n    maxIterations: 7\n', 'utf8')
    const { deps, calls } = makeDeps()
    await loopMain({ configPath: join(root, 'nx-mk.config.yml'), cwd: root, maxIterations: 2, deps })
    expect(calls[0]?.config.loop?.maxIterations).toBe(2)
  })

  it('config.agent.loop.maxIterations passes through without CLI override', async () => {
    const root = makeProject()
    writeFileSync(join(root, 'nx-mk.config.yml'), 'agent:\n  loop:\n    maxIterations: 7\n', 'utf8')
    const { deps, calls } = makeDeps()
    await loopMain({ configPath: join(root, 'nx-mk.config.yml'), cwd: root, deps })
    expect(calls[0]?.config.loop?.maxIterations).toBe(7)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/cli/src/__tests__/loop.test.ts`
Expected: FAIL（`../commands/loop.js` 不存在）

- [ ] **Step 3: 实现 packages/cli/src/commands/loop.ts**

```ts
/**
 * loop 子命令（spec §3.9）—— 消费 .nx-mk/coverage-report.json 跑 Agent Loop。
 * 装配层：createClaudeCodeProvider + 内置两 agent 构造后注入 runAgentLoop；
 * deps.runLoop 为测试缝（对齐 start.ts 的 StartDeps），CLI 测试不 spawn 真 claude。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { KernelError, makeRunId, type LogLevel } from '@nx-mk/kernel'
import { loadConfig, type AgentConfig } from '@nx-mk/config'
import {
  AGENT_DEFAULTS,
  createApiUiAgent,
  createClaudeCodeProvider,
  createReviewAgent,
  runAgentLoop,
  type CoverageReport,
  type LoopSummary,
} from '@nx-mk/agent'

export interface LoopCliDeps {
  runLoop: typeof runAgentLoop
}

export interface LoopMainOptions {
  configPath: string
  cwd?: string
  /** CLI --max-iterations 覆盖（优先级：CLI > config.agent.loop.maxIterations > 5） */
  maxIterations?: number
  cliOverrides?: { logLevel?: LogLevel; outputDir?: string }
  /** 测试缝：不注入则用真实实现 */
  deps?: LoopCliDeps
}

// 报告形状门（spec §3.2）：runId + metrics.requiredCoverage 存在；不过 → RUN_NOT_FOUND（E1）
function readCoverageReport(nxMkDir: string): CoverageReport {
  const reportPath = join(nxMkDir, 'coverage-report.json')
  if (!existsSync(reportPath)) {
    throw new KernelError('RUN_NOT_FOUND', `coverage report not found at ${reportPath} — run 'nx-mk run' first`)
  }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(reportPath, 'utf8'))
  } catch (err) {
    throw new KernelError('RUN_NOT_FOUND', `coverage report at ${reportPath} is not valid JSON — run 'nx-mk run' first`, err)
  }
  const r = raw as Partial<CoverageReport>
  if (!r || typeof r.runId !== 'string' || typeof r.metrics?.requiredCoverage !== 'number') {
    throw new KernelError('RUN_NOT_FOUND', `coverage report at ${reportPath} has an unexpected shape — run 'nx-mk run' first`)
  }
  return r as CoverageReport
}

// ratio → 百分比文本（对齐 run.ts 的 pct 摘要风格）
function pct(ratio: number): string {
  return `${(Math.round(ratio * 1000) / 10).toFixed(1)}%`
}

export async function loopMain(opts: LoopMainOptions): Promise<void> {
  const cwd = opts.cwd ?? process.cwd()
  // 预检配置存在性（E2，对齐 start.ts：显式 missing 保持 CONFIG_NOT_FOUND 语义）
  if (!existsSync(opts.configPath)) {
    throw new KernelError('CONFIG_NOT_FOUND', `Config file not found: ${opts.configPath}`)
  }
  const config = await loadConfig({
    path: opts.configPath,
    cwd,
    runId: makeRunId('loop'),
    subcommand: 'loop',
    ...(opts.cliOverrides ? { cliOverrides: opts.cliOverrides } : {}),
  })
  // config.agent 段：kernel Config 无此字段 → cast（对齐 start.ts 的 dashboard cast，PLN-3）
  const agentCfg: AgentConfig = (config as typeof config & { agent?: AgentConfig }).agent ?? {}
  // CLI 覆盖合并：--max-iterations > config.agent.loop.maxIterations
  // （无 loop 配置且无 CLI 覆盖时不添 loop 键 —— mergedCfg 与 config.agent 逐字一致）
  const loopCfg = { ...agentCfg.loop, ...(opts.maxIterations !== undefined ? { maxIterations: opts.maxIterations } : {}) }
  const mergedCfg: AgentConfig = { ...agentCfg, ...(Object.keys(loopCfg).length > 0 ? { loop: loopCfg } : {}) }

  const report = readCoverageReport(join(cwd, '.nx-mk'))

  const deps = opts.deps ?? { runLoop: runAgentLoop }
  const summary: LoopSummary = await deps.runLoop(
    { projectRoot: cwd, report, config: mergedCfg, log: (msg) => console.log(msg) },
    {
      provider: createClaudeCodeProvider({
        projectRoot: cwd,
        timeoutMs: agentCfg.provider?.timeoutMs ?? AGENT_DEFAULTS.provider.timeoutMs,
        maxTurns: agentCfg.provider?.maxTurns ?? AGENT_DEFAULTS.provider.maxTurns,
      }),
      apiUiAgent: createApiUiAgent(),
      reviewAgent: createReviewAgent(),
    },
  )

  // stdout 摘要（spec §3.9，英文）
  console.log(`Agent loop completed: ${summary.agentRunId}`)
  console.log(
    `  iterations: ${summary.iterations}  produced: ${summary.produced}  rejected: ${summary.rejected}` +
    `  failed: ${summary.failed}  given-up: ${summary.givenUp}  (stopped by: ${summary.stoppedBy})`,
  )
  console.log(`  report runId: ${report.runId} (requiredCoverage ${pct(report.metrics.requiredCoverage)})`)
  console.log(`  patches: ${summary.patchDir}/`)
  console.log(`  next: git apply ${summary.patchDir}/*.patch && nx-mk run`)
}
```

- [ ] **Step 4: cli/src/index.ts 接线五处**

1. import 区（`startMain` import 后）：`import { loopMain } from './commands/loop.js'`
2. line 23 子命令联合：`type Subcommand = 'run' | 'init' | 'doctor' | 'migrate' | 'start' | 'loop'`
3. `ParsedArgs` 追加字段（`start` 字段后）：

```ts
  loop: {
    maxIterations?: number
  }
```

4. `parseArgs` 初始 `out` 加 `loop: {},`；token 循环加 case（`--dry-run` case 之后）：

```ts
      case '--max-iterations': {
        const raw = argv[++i]
        const n = Number(raw)
        if (!Number.isInteger(n) || n < 1) {
          throw new KernelError('KERNEL_INTERNAL', `Invalid --max-iterations: ${raw}`)
        }
        out.loop.maxIterations = n
        break
      }
```

子命令分组 case（`case 'start':` 后）加 `case 'loop':`。

5. `main()` 的 switch 加 case（`case 'start'` 块之后）：

```ts
    case 'loop': {
      // loop 必须有配置文件（agent 段可选 —— 全默认值可跑）
      const configPath = await resolveConfigPath(args.configPath)
      await loopMain({
        configPath,
        ...(args.loop.maxIterations !== undefined ? { maxIterations: args.loop.maxIterations } : {}),
        cliOverrides: { logLevel: args.logLevel, outputDir: args.outputDir },
      })
      return
    }
```

6. HELP 文本：`Subcommands:` 段 `start` 行后加一行：

```
  loop     Run the Agent Loop: turn coverage gaps into suggested diffs (no workspace writes)
```

`Options:` 段 `--no-run` 行后加：

```
  --max-iterations <n>   (loop) override agent.loop.maxIterations
```

- [ ] **Step 5: cli/package.json 加依赖**

`dependencies` 追加 `"@nx-mk/agent": "workspace:*"`，然后 `corepack pnpm install`。

- [ ] **Step 6: 跑测试确认通过 + CLI 回归 + commit**

Run: `corepack pnpm install && npx vitest run packages/cli`
Expected: loop.test.ts PASS（6 tests）；CLI 既有测试 PASS
Run: `npx vitest run`
Expected: 全绿
Run: `corepack pnpm -F @nx-mk/cli build`
Expected: 无错误

```bash
git add packages/cli
git commit -m "feat(cli): nx-mk loop 子命令 —— 报告消费 + RUN_NOT_FOUND + stdout 摘要"
```

---

### Task 9: 集成测试 —— 真实 git 全链（phase5-agent.test.ts）

**Files:**
- Create: `tests/integration/phase5-agent.test.ts`

**Interfaces:**
- Consumes: 全部 agent 出口（Tasks 2-7）；真实 `git` CLI（环境已有）；`openCoverageDb`。
- Produces: 无出口 —— 本任务只交付测试，验证「真 git apply --check 的 G1 pass/reject、R10 非 git skipped、共享库行、补丁可被真实 git 应用」。

- [ ] **Step 1: 写集成测试**

`tests/integration/phase5-agent.test.ts`：

```ts
/**
 * Phase 5 真链路集成（spec §5 末行 + §6.1）：真实 git 仓库 + 真实 review guard +
 * 真实 sqlite 共享库；只有 provider 是 scripted（真实 claude 不进 CI）。
 */
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { promisify } from 'node:util'
import { openCoverageDb } from '@nx-mk/coverage'
import {
  createApiUiAgent,
  createReviewAgent,
  runAgentLoop,
  type AgentProvider,
  type CoverageReport,
} from '@nx-mk/agent'

const execFileP = promisify(execFile)

const SRC = `export function Card() {
  return <div className="card">placeholder</div>
}
`

// 可被真实 git apply 的 diff（对 SRC 逐字）
const GOOD_DIFF = `diff --git a/src.tsx b/src.tsx
--- a/src.tsx
+++ b/src.tsx
@@ -1,3 +1,4 @@
 export function Card() {
-  return <div className="card">placeholder</div>
+  return <div className="card" data-mk-field="GET /users.200.data.name">placeholder</div>
+  {/* field rendered */}
 }
`

// 指向不存在文件的 diff → git apply --check 必败（G1 reject 路径）
const BAD_DIFF = `diff --git a/missing.tsx b/missing.tsx
--- a/missing.tsx
+++ b/missing.tsx
@@ -1,1 +1,2 @@
-  nothing
+  nothing else
`

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

// 真实 git 仓库 + 初始提交（apply --check 的对照基线）
function makeGitProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'nx-mk-agent-e2e-'))
  writeFileSync(join(root, 'src.tsx'), SRC)
  git(root, ['init'])
  git(root, ['add', '-A'])
  git(root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'init'])
  return root
}

function makeReport(ignored: string[] = []): CoverageReport {
  return {
    runId: 'run_base',
    metrics: {
      requiredCoverage: 0, effectiveCoverage: 0, rawBackendFieldCoverage: 0,
      endpointsTotal: 1, endpointsCalled: 1, fieldsTotal: 1, fieldsReturned: 1,
      requiredFields: 1, missingRequiredFields: 1,
      ignoredReturnedFields: ignored.length, suspiciousFields: 0,
    },
    missingRequiredFields: [
      { fieldId: 'GET /users.200.data.name', fieldPath: 'data.name', endpointId: 'getUsers', state: 'missing', policyStatus: 'required' },
    ],
    weakEvidenceFields: [],
    ignoredReturnedFields: ignored.map((id) => ({ fieldId: id, fieldPath: id, state: 'ignored' as const, policyStatus: 'ignored' as const })),
    suspiciousCoverage: [],
    endpoints: [{ endpointId: 'getUsers', method: 'GET', path: '/users', called: true, fieldsTotal: 1, fieldsCovered: 0 }],
    requests: [],
  }
}

function providerReturning(diffText: string): AgentProvider {
  return { name: 'fake', edit: async () => ({ diffText }) }
}

async function gitApplyCheckReal(cwd: string, patchPath: string): Promise<boolean> {
  try {
    await execFileP('git', ['apply', '--check', patchPath], { cwd })
    return true
  } catch {
    return false
  }
}

describe('Phase 5 integration — real git + real guard', () => {
  it('produces an applicable patch (G1 pass) and records agent_iterations in the shared db', async () => {
    const root = makeGitProject()
    const summary = await runAgentLoop(
      { projectRoot: root, report: makeReport(), config: {} },
      { provider: providerReturning(GOOD_DIFF), apiUiAgent: createApiUiAgent(), reviewAgent: createReviewAgent() },
    )
    expect(summary.produced).toBe(1)
    expect(summary.stoppedBy).toBe('backlog-empty')
    const patch = join(root, summary.patchDir, 'iter-1-GET_/users.200.data.name.patch')
    // 真实 git 认可这个 patch 可应用
    expect(await gitApplyCheckReal(root, patch)).toBe(true)
    // 共享库（.nx-mk/coverage.db）两表落行
    const db = openCoverageDb(join(root, '.nx-mk', 'coverage.db'))
    const iters = db.prepare('SELECT * FROM agent_iterations').all() as Record<string, unknown>[]
    const runs = db.prepare('SELECT * FROM runs WHERE id = ?').all(summary.agentRunId) as Record<string, unknown>[]
    db.close()
    expect(iters).toHaveLength(1)
    expect(iters[0]?.status).toBe('produced')
    expect(iters[0]?.after_coverage).toBeNull()
    expect(runs[0]?.status).toBe('completed')
    // R4：空 run 目录存在（dashboard 目录扫描可见）+ 产物只落在 .nx-mk/ 下（D1 铁律）
    expect(existsSync(join(root, '.nx-mk', 'runs', summary.agentRunId))).toBe(true)
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })).toContain('?? .nx-mk/')
  })

  it('archives a non-applicable diff under rejected/ (G1 reject, E7)', async () => {
    const root = makeGitProject()
    const summary = await runAgentLoop(
      { projectRoot: root, report: makeReport(), config: { loop: { stopIfNoImprovementRounds: 1 } } },
      { provider: providerReturning(BAD_DIFF), apiUiAgent: createApiUiAgent(), reviewAgent: createReviewAgent() },
    )
    expect(summary.produced).toBe(0)
    expect(summary.rejected).toBe(1)
    expect(summary.givenUp).toBe(1)
    const rejectedDir = join(root, '.nx-mk', 'patches', summary.agentRunId, 'rejected')
    expect(readdirSync(rejectedDir)).toHaveLength(2)
  })

  it('rejects an applicable diff that renders an ignored field (G2, D3)', async () => {
    const root = makeGitProject()
    const ignoredDiff = GOOD_DIFF.replace('data.name', 'data.internalRiskScore')
    const summary = await runAgentLoop(
      { projectRoot: root, report: makeReport(['data.internalRiskScore']), config: { loop: { stopIfNoImprovementRounds: 1 } } },
      { provider: providerReturning(ignoredDiff), apiUiAgent: createApiUiAgent(), reviewAgent: createReviewAgent() },
    )
    expect(summary.produced).toBe(0)
    expect(summary.givenUp).toBe(1)
    const db = openCoverageDb(join(root, '.nx-mk', 'coverage.db'))
    const iters = db.prepare('SELECT status, summary FROM agent_iterations').all() as { status: string; summary: string }[]
    db.close()
    expect(iters.some((r) => r.summary.includes('ignored-render'))).toBe(true)
  })

  it('skips G1 on a non-git project and still produces (R10)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nx-mk-agent-nogit-'))
    writeFileSync(join(root, 'src.tsx'), SRC)
    const summary = await runAgentLoop(
      { projectRoot: root, report: makeReport(), config: {} },
      { provider: providerReturning(GOOD_DIFF), apiUiAgent: createApiUiAgent(), reviewAgent: createReviewAgent() },
    )
    expect(summary.produced).toBe(1) // verdict 仅由 G2-G4 决定
  })
})
```


- [ ] **Step 2: 跑测试确认通过**

Run: `npx vitest run tests/integration/phase5-agent.test.ts`
Expected: PASS（4 tests）。若 git 不在 PATH 或行尾问题导致 GOOD_DIFF 不适用：检查 `core.autocrlf`（仓库已在 `.gitattributes` 约束下工作）；PATCH 内容一律 `\n`（writePatchFile 已保证）。

- [ ] **Step 3: 全量回归 + commit**

Run: `npx vitest run`
Expected: 全绿（Phase 4 基线 413 + 本期新增）

```bash
git add tests/integration/phase5-agent.test.ts
git commit -m "test(integration): Phase 5 真链路 —— 真实 git apply / guard reject / 非 git 仓库"
```

---

### Task 10: demo 配置示例 + README Agent Loop 段

**Files:**
- Modify: `examples/react-vite-demo/nx-mk.config.yml`（文件尾追加注释掉的 agent 段示例）
- Modify: `README.md`（新增 Agent Loop 小节 + 包结构列表加 agent 行）

**Interfaces:**
- Consumes: T6 的 config 段语义、T8 的 CLI 用法。
- Produces: 文档交付（spec §6.1.3：demo 不强制 agent 段 —— 注释示例 + README 可选段说明）。

- [ ] **Step 1: demo config 追加注释示例**

在 `examples/react-vite-demo/nx-mk.config.yml` 的 `dashboard:` 块之后追加：

```yaml

# Phase 5 Agent Loop（可选 —— 无此段 = 全默认值）。`nx-mk loop` 消费最新 coverage report，
# 把 missing required 字段交给本地 claude CLI 产 diff 到 .nx-mk/patches/（不写工作区）；
# 人工 git apply 后重跑 nx-mk run 验证 requiredCoverage 提升。
# agent:
#   provider:
#     type: claude-code
#     timeoutMs: 300000
#     maxTurns: 8
#   loop:
#     maxIterations: 5
#     stopIfNoImprovementRounds: 2
#     maxTasksPerIteration: 5
```

- [ ] **Step 2: README 新增段落**

先读 `README.md`，在 Dashboard 使用段之后插入（标题层级与相邻小节一致）：

```markdown
## Agent Loop（Phase 5，实验）

`nx-mk loop` 读取最新 `.nx-mk/coverage-report.json`，把 missing required 字段分批交给本地 `claude` CLI 产出 unified diff，经静态 review guard 后落 `.nx-mk/patches/`。全程不写工作区文件（suggest-diff 模式）：

```bash
nx-mk run          # 先产出 coverage report
nx-mk loop         # 产 diff → .nx-mk/patches/<agentRunId>/
git apply .nx-mk/patches/<agentRunId>/*.patch
nx-mk run          # 验证 requiredCoverage 真实提升
```

前置：本地已安装并登录 `claude` CLI（loop 只授 Read/Grep/Glob 只读工具，agent 无写文件通道）。可选配置（provider 超时 / 轮数 / 批次）见 demo `nx-mk.config.yml` 尾部注释。注意：含 `/` 的字段 id 生成的补丁文件名可能带子目录，shell 通配用 `find .nx-mk/patches/<id> -name '*.patch'` 更稳。
```

再在 README 的「包结构」列表（Phase 4 后的包清单）按既有条目风格追加一行：

```markdown
- packages/agent — Agent Loop（claude-code provider / api-ui-agent / review-agent / suggest-diff 落盘）
```

- [ ] **Step 3: 验证 demo config 仍可解析**

Run: `npx vitest run`（全绿即可 —— config 解析测试已覆盖注释 YAML 不受影响；YAML 注释块语法由既有 loader 测试隐式保障）

- [ ] **Step 4: commit**

```bash
git add examples/react-vite-demo/nx-mk.config.yml README.md
git commit -m "feat(demo,docs): agent 段注释示例 + README Agent Loop 使用段"
```

---

## 验收对照（spec §6）

| spec 验收项 | 落点 |
|---|---|
| §6.1.1 全套 vitest 绿 | T9 Step 3（全量回归） |
| §6.1.2 全包 build 绿（agent tsup 产物可被 cli import） | T7 Step 6 + T8 Step 5/6 |
| §6.1.3 demo 不强制 agent 段，README 给可选段 | T10 |
| §1.2.2 `nx-mk loop` 子命令 + stdout 摘要 | T8 |
| §1.2.3 D1 suggest-diff 铁律 | T2/T3（只读工具集）/T7（只落 .nx-mk） |
| §1.2.4 review guard 静态不调 AI | T4 |
| §1.2.5 agent_iterations 落共享库 | T7（INSERT）+ T9（真库断言） |
| §1.2.6 config agent 段 + 三处接线 + 退出码 | T3（错误码）/T6/T8 |
| §1.2.7 注入式可测（LoopDeps 缝） | T7（runtime 测试）/T8（CLI 测试） |
| §6.2 demo 手动验收 | 人工执行（README 记步骤，T10） |
