# §26 Scenario DSL 运行器 + Replay Scenario Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户在 `mk/scenarios/*.yml` 手写 Scenario DSL（5 种 step），`nx-mk run` 按套件并发执行产出带 scenarioId/dslStepId 的 trace 与 field hits，dashboard `/scenarios` 页一键回放任一场景并看步骤级结果。

**Architecture:** 新包 `@nx-mk/scenario` 承载 DSL schema/loader/纯逻辑 runner/playwright 驱动/回放留痕（计划 §8 文件树锚点）；config 增 `scenarios:` 段（include 非空激活套件模式，缺省回落 legacy collect 零破坏）；plugin-playwright beforeRun 分叉套件模式（每步 drainBrowserCollector 归因 + goto 后既有 DOM 扫描，覆盖语义不变）；dashboard 只 import scenario 包高层入口 `replayScenario`（playwright-core 由 scenario 包内部解析，dashboard 零浏览器依赖面），POST 串行锁 409。

**Tech Stack:** TypeScript ESM、zod（DSL schema）、yaml@^2.4.5（场景文件解析，lockfile 既有）、playwright-core@^1.49.0（scenario 包内浏览器驱动，lockfile 既有）、fastify（路由）、React 19 renderToString（UI 测试）、vitest。

**Spec:** `docs/superpowers/specs/2026-09-21-nx-mk-scenario-dsl-replay-design.md`（S1-S13 裁定、§2.3 API、E1-E9 错误表——本计划据其论证，冲突以 spec 为准，唯 Plan-Level Rulings 节显式修订处除外）

## Global Constraints（每个任务隐式继承）

- **D2 依赖铁律**：零新增外部 npm 包（yaml / playwright-core 均 lockfile 既有）；dashboard 只加 workspace 内部依赖 `@nx-mk/scenario: workspace:*`
- **铁律 R12**：dashboard server 的 fs 写路径白名单仍只有 `replay.ts` 一个文件——scenario trail 写者在 `packages/scenario/src/scenario-replay.ts`
- 单文件 ≤400 行；ESM 相对导入带 `.js` 后缀；`verbatimModuleSyntax`（类型导入用 `import type`）；`noUncheckedIndexedAccess`（数组访问判空）；中文注释 + 英文 CLI/tests 标识符
- 测试从 repo 根跑：`PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH npx vitest run`；typecheck：`PATH=...:$PATH pnpm -r typecheck`
- **运维缝（v1 写回链裁定继承）**：kernel/client/coverage 类型变更后须 `pnpm --filter @nx-mk/<pkg> build` 刷 dist d.ts，否则下游 typecheck 读旧声明
- 提交信息不带任何 attribution 行（用户常设指令），Conventional Commits 中文描述
- 向后兼容：无 `scenarios:` 段的 config → legacy collect 行为分毫不差（既有全绿即证）；`scenario_id/dsl_step_id` 列缺省 NULL 不破旧 run 查询

## Plan-Level Rulings（对 spec 的显式修订/澄清，SDD 执行时按此裁定）

| # | 裁定 | 理由 / 代价 |
|---|---|---|
| SP1 | 文件路径 glob 由 scenario 包**自实现** `globToRegExp`（`**`→`.*`、`*`→`[^/]*`、其余转义，~15 行）；**不**复用 coverage 的 `matchGlob`——那是点段语义（字段路径 `user.profile.*`），与 `/` 段文件路径语义不同源 | spec §2.2"复用 coverage/policy/glob"按此修订；T9 收尾回写 spec §6 |
| SP2 | step `id` 字段 optional（§26.1 示例带 id 但原文 schema 未钉死）；缺省自动 `${scenarioId}-step-${index}`；`dslStepId` 归因用该有效 id | 兼容无 id 的极简场景文件 |
| SP3 | 套件模式 turn 语义：`ctx.getTurn()` 取一次，每场景完成后 `collector.snapshot(turn)` 增量幂等（同 key+count 不重报），报告逐场景 flush——**不自增 turn、不动 goal-loop 机制** | snapshot 幂等语义（collector.ts:3 注释）天然支持复用同一 turn |
| SP4 | suite/replay 的浏览器生命周期都封装在 scenario 包：`runScenarioSuite`（run 期，多 context 池）与 `replayScenario`（单场景）内部 import playwright-core + launch/close；plugin/dashboard 只调高层入口 | dashboard 永不直接 import playwright-core；scenario 包 deps 加 `playwright-core: ^1.49.0`（lockfile 既有版本） |
| SP5 | `waitForRequest` 语义 = `page.waitForRequest` 谓词命中即成功（不等响应完成）；归因：该步后的 drain 以 `{scenarioId, dslStepId: 该步有效id}` 精确打标，其余步后 drain 只打 `{scenarioId}` | 与页内 shim trace 记录时机（响应侧）窗口最小化；spec S6 落地口径 |
| SP6 | 套件模式 observers 由 plugin-playwright 提供：`afterGoto` → `scanPage` + field-hit emitReport（与 legacy 逐字同语义）；`afterStep` → `drainBrowserCollector(evaluate, collector, tag)` | 归因与扫描插桩留在 plugin（领域归属），scenario 包保持纯编排 |
| SP7 | `runScenario` 失败后的 drain：失败步也触发一次 drain（打 `{scenarioId}` 无 stepId），保证失败前页内缓冲 trace 不丢 | E5 fail-fast 与归因完备性兼容 |
| SP8 | replay 的 runId 仅用于路由一致性（404 unknown run 门）与未来按 run 过滤；trail 实际落 `replays/scenarios/<scenarioId>/`（场景与 run 无强绑定） | spec §2.1 落盘路径原文维持 |
| SP9 | demo 手动验收物料（场景 YAML + config 片段）在 T9 给出精确内容，属用户手动步骤——**不**改 examples/ 仓库文件 | demo 仓配置属用户工作区，计划只验产品代码 |

## File Structure

```
packages/scenario/                 # 新包（T1 脚手架；模板 = plugin-swagger 形制）
  package.json                     # deps: yaml, playwright-core, zod; workspace: @nx-mk/coverage(类型无需，不依赖)
  tsconfig.json / tsup.config.ts
  src/
    dsl-schema.ts                  # T1: ScenarioFileSchema + 5 step discriminated union + 类型
    dsl-loader.ts                  # T2: globToRegExp + loadScenarios(cwd, include) → {scenarios, skipped}
    runner.ts                      # T3: StepDriver/StepResult/ScenarioRunResult + runScenario(纯逻辑) + runScenarioSuite(纯调度，池注入)
    playwright-runner.ts           # T4: hasChromium(迁入) + createPlaywrightDriver + runScenarioWithPage + runScenarioSuiteInBrowser(SP4)
    scenario-replay.ts             # T7: replayScenario + ScenarioReplayError + trail 写盘
    __tests__/*.test.ts            # T1/T2/T3/T4/T7 各一
packages/config/src/schema.ts      # T5: ScenarioConfigSchema + ConfigSchema.scenarios? + 类型导出
packages/client/src/collector/collector.ts   # T5: RequestTraceCore + scenarioId?/dslStepId?
packages/coverage/src/db/client.ts           # T5: INSERT 扩两列
packages/plugin-playwright/src/
  scanner.ts                       # T5: drainBrowserCollector 第三参 tag
  runner.ts                        # T4: hasChromium 迁出（re-export 向后兼容）
  index.ts                         # T6: beforeRun 套件分叉 + observers + 事件 + E8 汇总
packages/kernel/src/event-bus.ts   # T6: KernelEvent union + scenario:start/scenario:done
packages/dashboard/src/
  shared/api-types.ts              # T8: ScenarioView/ScenariosResponse/ScenarioReplayResponse
  server/routes/scenarios.ts       # T8: GET /api/scenarios + POST replay/scenario + 串行锁
  server/index.ts                  # T8: registerScenarioRoutes
  ui/pages/Scenarios.tsx           # T9
  ui/router.tsx + App.tsx          # T9: PageId/ROUTES/nav
  package.json                     # T8: + @nx-mk/scenario workspace（pnpm install 刷 lockfile）
```

---

### Task 1: 新包脚手架 + dsl-schema（5 种 step 联合）

**Files:**
- Create: `packages/scenario/package.json`、`tsconfig.json`、`tsup.config.ts`、`src/index.ts`、`src/dsl-schema.ts`
- Test: `packages/scenario/src/__tests__/dsl-schema.test.ts`
- Modify: `pnpm-lock.yaml`（`pnpm install` 刷新，随 commit）

**Interfaces:**
- Consumes: 无（首任务）
- Produces（后续任务依赖的精确形状）:
  - `ScenarioFileSchema` / `ScenarioSchema` / `ScenarioStepSchema`（zod）+ 类型 `ScenarioFile` / `Scenario` / `ScenarioStep`
  - step 类型：`{type:'goto', url}`、`{type:'waitFor', selector, timeoutMs?}`、`{type:'waitForRequest', urlPattern, timeoutMs?}`、`{type:'assertFieldVisible', field, timeoutMs?}`、`{type:'screenshot', path?}`；step `id?`（SP2）；`Scenario{id: /^[a-z0-9][a-z0-9-]*$/, name, route?, steps: 1-50}`
  - `index.ts` 重导出全部公共 API（随各任务增量）

- [ ] **Step 1: 脚手架**

按 plugin-swagger 形制创建。`packages/scenario/package.json`：

```json
{
  "name": "@nx-mk/scenario",
  "version": "0.1.0",
  "private": true,
  "description": "nx-mk Scenario DSL — schema/loader/runner/playwright driver/replay trail (plan §8)",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist .turbo *.tsbuildinfo"
  },
  "dependencies": {
    "playwright-core": "^1.49.0",
    "yaml": "^2.4.5",
    "zod": "^3.22.4"
  },
  "devDependencies": {
    "typescript": "^5.3.3",
    "tsup": "^8.0.2",
    "vitest": "^1.0.4",
    "@types/node": "^20.10.0"
  }
}
```

`tsconfig.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

`tsup.config.ts`：复制 `packages/plugin-swagger/tsup.config.ts` 原文（入口 src/index.ts、dts、esm、clean，逐字不改仅包内路径天然一致）。`src/index.ts` 暂为：

```ts
/** @nx-mk/scenario 公共 API 入口（§8 树：dsl-schema/dsl-loader/runner/playwright-runner/scenario-replay） */
export { ScenarioFileSchema, ScenarioSchema, ScenarioStepSchema, GotoStepSchema, WaitStepSchema, WaitForRequestStepSchema, AssertFieldVisibleStepSchema, ScreenshotStepSchema, type ScenarioFile, type Scenario, type ScenarioStep, type GotoStep, type WaitStep, type WaitForRequestStep, type AssertFieldVisibleStep, type ScreenshotStep } from './dsl-schema.js'
```

然后在工作区根：`PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH pnpm install`（刷新 lockfile 的新 importer 条目；无新外部包，仅 workspace 注册）。

- [ ] **Step 2: 写失败测试**

`packages/scenario/src/__tests__/dsl-schema.test.ts`：

```ts
/**
 * ScenarioFileSchema（spec S2/SP2）：5 种 step discriminated union + version 门 + id 约束。
 */
import { describe, it, expect } from 'vitest'
import { ScenarioFileSchema, ScenarioStepSchema } from '../dsl-schema'

const base = { version: 1, scenarios: [{ id: 'user-profile', name: '用户详情', steps: [] }] }

describe('ScenarioStepSchema — 5 种 step', () => {
  it('goto / waitFor / waitForRequest / assertFieldVisible / screenshot 各自解析', () => {
    expect(ScenarioStepSchema.parse({ type: 'goto', url: '/users/1' })).toEqual({ type: 'goto', url: '/users/1' })
    expect(ScenarioStepSchema.parse({ type: 'waitFor', selector: '[data-page]' })).toEqual({ type: 'waitFor', selector: '[data-page]' })
    expect(ScenarioStepSchema.parse({ type: 'waitForRequest', urlPattern: '/api/users' })).toEqual({ type: 'waitForRequest', urlPattern: '/api/users' })
    expect(ScenarioStepSchema.parse({ type: 'assertFieldVisible', field: 'user.name' })).toEqual({ type: 'assertFieldVisible', field: 'user.name' })
    expect(ScenarioStepSchema.parse({ type: 'screenshot' })).toEqual({ type: 'screenshot' })
  })

  it('step id optional（SP2）+ 非法 type / 空 url 拒绝', () => {
    expect(ScenarioStepSchema.parse({ type: 'goto', url: '/x', id: 'open-x' }).id).toBe('open-x')
    expect(() => ScenarioStepSchema.parse({ type: 'hover', selector: 'x' })).toThrow()
    expect(() => ScenarioStepSchema.parse({ type: 'goto', url: '' })).toThrow()
  })
})

describe('ScenarioFileSchema', () => {
  it('version 必须 = 1；steps 1-50；id kebab 门', () => {
    expect(() => ScenarioFileSchema.parse({ ...base, version: 2 })).toThrow()
    expect(() => ScenarioFileSchema.parse({ ...base, scenarios: [{ id: 's', name: 'n', steps: [] }] })).toThrow()
    expect(() => ScenarioFileSchema.parse({ ...base, scenarios: [{ id: 'BAD ID', name: 'n', steps: [{ type: 'screenshot' }] }] })).toThrow()
    const ok = ScenarioFileSchema.parse({
      version: 1,
      scenarios: [{ id: 's1', name: 'n', route: '/users/1', steps: [{ type: 'screenshot' }] }],
    })
    expect(ok.scenarios[0]!.steps).toHaveLength(1)
  })

  it('51 步拒绝（上限门）', () => {
    const steps = Array.from({ length: 51 }, () => ({ type: 'waitFor' as const, selector: 'x' }))
    expect(() => ScenarioFileSchema.parse({ ...base, scenarios: [{ id: 's', name: 'n', steps }] })).toThrow()
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH npx vitest run packages/scenario`
Expected: FAIL —— `../dsl-schema` 不存在

- [ ] **Step 4: 实现 dsl-schema.ts**

```ts
/**
 * Scenario DSL 文件 schema（spec §26.1 + S2/SP2）：
 * version 1；scenarios[]{id, name, route?, steps[]}；step discriminated union 5 种。
 * click/fill/assertVisible（§26.3 其余）后置——表单流 demo 出现再加（spec 范围声明）。
 */
import { z } from 'zod'

// 场景 id：kebab-case（与场景文件名解耦——文件可含多场景）
const ScenarioIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'scenario id must be kebab-case')

const OptionalTimeout = z.number().int().positive().max(60000).optional()

export const GotoStepSchema = z.object({ type: z.literal('goto'), url: z.string().min(1), id: z.string().optional() })
export const WaitStepSchema = z.object({ type: z.literal('waitFor'), selector: z.string().min(1), timeoutMs: OptionalTimeout, id: z.string().optional() })
export const WaitForRequestStepSchema = z.object({ type: z.literal('waitForRequest'), urlPattern: z.string().min(1), timeoutMs: OptionalTimeout, id: z.string().optional() })
export const AssertFieldVisibleStepSchema = z.object({ type: z.literal('assertFieldVisible'), field: z.string().min(1), timeoutMs: OptionalTimeout, id: z.string().optional() })
export const ScreenshotStepSchema = z.object({ type: z.literal('screenshot'), path: z.string().optional(), id: z.string().optional() })

export const ScenarioStepSchema = z.discriminatedUnion('type', [
  GotoStepSchema,
  WaitStepSchema,
  WaitForRequestStepSchema,
  AssertFieldVisibleStepSchema,
  ScreenshotStepSchema,
])

export type GotoStep = z.infer<typeof GotoStepSchema>
export type WaitStep = z.infer<typeof WaitStepSchema>
export type WaitForRequestStep = z.infer<typeof WaitForRequestStepSchema>
export type AssertFieldVisibleStep = z.infer<typeof AssertFieldVisibleStepSchema>
export type ScreenshotStep = z.infer<typeof ScreenshotStepSchema>
export type ScenarioStep = z.infer<typeof ScenarioStepSchema>

export const ScenarioSchema = z.object({
  id: ScenarioIdSchema,
  name: z.string().min(1),
  route: z.string().optional(),
  steps: z.array(ScenarioStepSchema).min(1).max(50),
})
export type Scenario = z.infer<typeof ScenarioSchema>

export const ScenarioFileSchema = z.object({
  version: z.literal(1),
  scenarios: z.array(ScenarioSchema).min(1),
})
export type ScenarioFile = z.infer<typeof ScenarioFileSchema>
```

- [ ] **Step 5: 跑测试确认通过 + 包构建**

Run: `PATH=...:$PATH npx vitest run packages/scenario && PATH=...:$PATH pnpm --filter @nx-mk/scenario build`
Expected: 4 用例 PASS + tsup 构建成功

- [ ] **Step 6: 提交**

```bash
git add packages/scenario pnpm-lock.yaml
git commit -m "feat(scenario): 新包 @nx-mk/scenario + Scenario DSL schema（5 种 step discriminated union，S2/SP2）"
```

---

### Task 2: dsl-loader — globToRegExp + loadScenarios

**Files:**
- Create: `packages/scenario/src/dsl-loader.ts`
- Modify: `packages/scenario/src/index.ts`（导出）
- Test: `packages/scenario/src/__tests__/dsl-loader.test.ts`

**Interfaces:**
- Consumes: T1 的 `ScenarioFileSchema`/`Scenario`
- Produces:
  - `globToRegExp(pattern: string): RegExp`（SP1：`**`→`.*`、`*`→`[^/]*`、其余 `encodeURIComponent` 级转义——用 `replace(/[.*+?^${}()|[\]\\]/g, '\\$&')` 前先摘除通配符）
  - `loadScenarios(cwd: string, include: ReadonlyArray<string>): { scenarios: Array<{ scenario: Scenario; file: string }>; skipped: string[] }`——`skipped` 元素形如 `"<file>: <reason>"`（E1 跳过语义）；同 id 重复 → 首个胜出，后者进 skipped

- [ ] **Step 1: 写失败测试**

`packages/scenario/src/__tests__/dsl-loader.test.ts`：

```ts
/**
 * loadScenarios（spec E1/E4 + SP1）：路径段 glob / 多文件合并 / 形状门跳过 / 同 id 去重。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { globToRegExp, loadScenarios } from '../dsl-loader'

const FILE_A = { version: 1, scenarios: [{ id: 'user-profile', name: '用户详情', steps: [{ type: 'goto', url: '/users/1' }] }] }
const FILE_B = { version: 1, scenarios: [{ id: 'checkout', name: '结账', steps: [{ type: 'screenshot' }] }] }

describe('globToRegExp（SP1 路径段语义）', () => {
  it('** 跨段 / * 单段 / 字面转义', () => {
    expect(globToRegExp('mk/scenarios/**/*.yml').test('mk/scenarios/a/b.yml')).toBe(true)
    expect(globToRegExp('mk/scenarios/**/*.yml').test('mk/scenarios/a/b.json')).toBe(false)
    expect(globToRegExp('scenarios/*.yml').test('scenarios/a.yml')).toBe(true)
    expect(globToRegExp('scenarios/*.yml').test('scenarios/a/b.yml')).toBe(false)
    expect(globToRegExp('scenarios/a(x).yml').test('scenarios/a(x).yml')).toBe(true)
  })
})

describe('loadScenarios', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nx-mk-scen-'))
    mkdirSync(join(dir, 'mk/scenarios'), { recursive: true })
    writeFileSync(join(dir, 'mk/scenarios/a.yml'), JSON.stringify(FILE_A), 'utf8')
    writeFileSync(join(dir, 'mk/scenarios/b.yml'), JSON.stringify(FILE_B), 'utf8')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('glob 命中多文件 → 场景合并（JSON 也是合法 YAML 子集）', () => {
    const r = loadScenarios(dir, ['mk/scenarios/**/*.yml'])
    expect(r.scenarios.map((s) => s.scenario.id).sort()).toEqual(['checkout', 'user-profile'])
    expect(r.skipped).toEqual([])
  })

  it('E1：形状非法文件跳过并给原因；0 命中 → 空数组', () => {
    writeFileSync(join(dir, 'mk/scenarios/bad.yml'), 'version: 9\n', 'utf8')
    const r = loadScenarios(dir, ['mk/scenarios/*.yml'])
    expect(r.scenarios).toHaveLength(2)
    expect(r.skipped).toHaveLength(1)
    expect(r.skipped[0]).toContain('bad.yml')
    expect(loadScenarios(dir, ['nope/**/*.yml']).scenarios).toEqual([])
  })

  it('跨文件同 id → 首个胜出，后者进 skipped', () => {
    writeFileSync(join(dir, 'mk/scenarios/dup.yml'), JSON.stringify(FILE_A), 'utf8')
    const r = loadScenarios(dir, ['mk/scenarios/**/*.yml'])
    expect(r.scenarios.filter((s) => s.scenario.id === 'user-profile')).toHaveLength(1)
    expect(r.skipped.some((s) => s.includes('dup.yml'))).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `PATH=...:$PATH npx vitest run packages/scenario`
Expected: FAIL —— `../dsl-loader` 不存在

- [ ] **Step 3: 实现 dsl-loader.ts**

```ts
/**
 * Scenario 文件发现与加载（spec E1/E4 + SP1）：
 * include 模式 → 路径段 glob（** 跨段 / * 单段，其余字面）→ 逐文件 YAML 解析 + 形状门
 * → 同 id 去重（首个胜出）。形状非法/不可解析文件跳过并记原因（E1），不抛。
 * 注：coverage 的 matchGlob 是点段（字段路径）语义，与文件路径不同源——不共用（SP1）。
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { parse } from 'yaml'
import { ScenarioFileSchema, type Scenario } from './dsl-schema.js'

/** 路径段 glob → RegExp：`**` → .*（跨段）、`*` → [^/]*（单段）、其余字符转义 */
export function globToRegExp(pattern: string): RegExp {
  let out = ''
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        out += '.*'
        i++ // 吞掉第二个 *
      } else {
        out += '[^/\\\\]*' // 单段（Windows 分隔符兼容）
      }
    } else if ('\\^$.|?+()[]{}'.includes(ch)) {
      out += `\\${ch}`
    } else if (ch === '/') {
      out += '[/\\\\]' // 分隔符兼容
    } else {
      out += ch
    }
  }
  return new RegExp(`^${out}$`)
}

export interface LoadedScenario {
  scenario: Scenario
  file: string
}

export interface LoadScenariosResult {
  scenarios: LoadedScenario[]
  skipped: string[]
}

/** glob 前缀（首个通配符前）→ 递归枚举该目录 → 相对路径匹配 */
function collectFiles(baseDir: string, re: RegExp, absRoot: string, out: string[]): void {
  if (!existsSync(baseDir)) return
  for (const name of readdirSync(baseDir)) {
    const full = join(baseDir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      collectFiles(full, re, absRoot, out)
    } else if (re.test(relative(absRoot, full).split(sep).join('/'))) {
      out.push(full)
    }
  }
}

export function loadScenarios(cwd: string, include: ReadonlyArray<string>): LoadScenariosResult {
  const scenarios: LoadedScenario[] = []
  const skipped: string[] = []
  const seenIds = new Set<string>()
  for (const pattern of include) {
    // 首个通配符前的字面前缀 = 枚举根；无通配符则整串即文件路径
    const globIdx = pattern.search(/[*]/)
    const rootRel = globIdx === -1 ? pattern : pattern.slice(0, pattern.lastIndexOf('/', globIdx) + 1) || ''
    const re = globToRegExp(pattern)
    const files: string[] = []
    if (globIdx === -1) {
      if (existsSync(join(cwd, pattern))) files.push(join(cwd, pattern))
    } else {
      collectFiles(join(cwd, rootRel), re, join(cwd, rootRel), files)
    }
    for (const file of files) {
      let parsed: unknown
      try {
        parsed = parse(readFileSync(file, 'utf8'))
      } catch (err) {
        skipped.push(`${file}: unparseable yaml (${(err as Error).message})`)
        continue
      }
      const gate = ScenarioFileSchema.safeParse(parsed)
      if (!gate.success) {
        skipped.push(`${file}: invalid scenario file (${gate.error.issues[0]?.message ?? 'shape'})`)
        continue
      }
      for (const scenario of gate.data.scenarios) {
        if (seenIds.has(scenario.id)) {
          skipped.push(`${file}: duplicate scenario id '${scenario.id}' (first wins)`)
          continue
        }
        seenIds.add(scenario.id)
        scenarios.push({ scenario, file })
      }
    }
  }
  return { scenarios, skipped }
}
```

`index.ts` 导出行追加：`export { globToRegExp, loadScenarios, type LoadedScenario, type LoadScenariosResult } from './dsl-loader.js'`

- [ ] **Step 4: 跑测试确认通过**

Run: `PATH=...:$PATH npx vitest run packages/scenario`
Expected: 7 用例 PASS

- [ ] **Step 5: 提交**

```bash
git add packages/scenario
git commit -m "feat(scenario): dsl-loader —— 路径段 globToRegExp + loadScenarios（E1 跳过 / 同 id 去重，SP1）"
```

---

### Task 3: runner — 纯逻辑步进执行器 + 套件调度

**Files:**
- Create: `packages/scenario/src/runner.ts`
- Modify: `packages/scenario/src/index.ts`
- Test: `packages/scenario/src/__tests__/runner.test.ts`

**Interfaces:**
- Consumes: T1 的 `Scenario`/`ScenarioStep`
- Produces（T4/T6/T7 依赖）:
  - `interface StepDriver { goto(url): Promise<void>; waitFor(selector, timeoutMs?): Promise<void>; waitForRequest(urlPattern, timeoutMs?): Promise<void>; assertFieldVisible(field, timeoutMs?): Promise<void>; screenshot(path?): Promise<void>; drain(tag: { scenarioId: string; dslStepId?: string }): Promise<void> }`
  - `interface StepResult { stepId: string; type: ScenarioStep['type']; ok: boolean; durationMs: number; error?: string }`
  - `interface ScenarioRunResult { scenarioId: string; ok: boolean; steps: StepResult[] }`
  - `stepIdOf(scenarioId: string, step: ScenarioStep, index: number): string`（SP2：`step.id ?? \`${scenarioId}-step-${index}\``）
  - `runScenario(scenario: Scenario, driver: StepDriver): Promise<ScenarioRunResult>`（纯逻辑：步进 / E5 fail-fast / SP7 失败也 drain / waitForRequest 步 drain 带精确 dslStepId——SP5）
  - `runScenarioSuite<Ctx>(items: ReadonlyArray<{ scenario: Scenario; ctx: Ctx }>, opts: { concurrency: number; worker: (item: { scenario: Scenario; ctx: Ctx }) => Promise<ScenarioRunResult> }): Promise<ScenarioRunResult[]>`（纯池调度，浏览器生命周期不在本层——SP4 分层；结果保持输入顺序）

- [ ] **Step 1: 写失败测试**

`packages/scenario/src/__tests__/runner.test.ts`：

```ts
/**
 * runScenario 纯逻辑（spec E5/S8/SP5/SP7）：步进顺序 / fail-fast / drain 归因 / 套件池调度。
 */
import { describe, it, expect } from 'vitest'
import { runScenario, runScenarioSuite, stepIdOf, type StepDriver, type ScenarioRunResult } from '../runner'
import type { Scenario } from '../dsl-schema'

/** 假驱动：记录调用序；可注入失败点与 drain 记录 */
function fakeDriver(failAt?: string): StepDriver & { calls: string[]; drains: Array<{ scenarioId: string; dslStepId?: string }> } {
  const calls: string[] = []
  const drains: Array<{ scenarioId: string; dslStepId?: string }> = []
  const step = async (name: string): Promise<void> => {
    calls.push(name)
    if (failAt === name) throw new Error(`boom: ${name}`)
  }
  return {
    calls,
    drains,
    goto: (url) => step(`goto:${url}`),
    waitFor: (s) => step(`waitFor:${s}`),
    waitForRequest: (p) => step(`waitForRequest:${p}`),
    assertFieldVisible: (f) => step(`assert:${f}`),
    screenshot: () => step('screenshot'),
    drain: (tag) => {
      drains.push(tag)
      return Promise.resolve()
    },
  }
}

const SCEN: Scenario = {
  id: 's1',
  name: 'n',
  steps: [
    { type: 'goto', url: '/a' },
    { type: 'waitFor', selector: '[x]' },
    { type: 'waitForRequest', urlPattern: '/api/a' },
    { type: 'assertFieldVisible', field: 'a.b' },
    { type: 'screenshot' },
  ],
}

describe('runScenario', () => {
  it('全绿：按序执行 5 步，每步后 drain；waitForRequest 步 drain 带精确 dslStepId（SP5）', async () => {
    const d = fakeDriver()
    const r = await runScenario(SCEN, d)
    expect(r.ok).toBe(true)
    expect(r.steps.map((s) => s.ok)).toEqual([true, true, true, true, true])
    expect(d.calls).toHaveLength(5)
    expect(d.drains).toHaveLength(5)
    expect(d.drains[2]).toEqual({ scenarioId: 's1', dslStepId: 's1-step-2' })
    expect(d.drains[0]).toEqual({ scenarioId: 's1' })
  })

  it('E5 fail-fast：第 3 步炸 → 后续不执行 + ok:false + SP7 失败也 drain', async () => {
    const d = fakeDriver('waitForRequest:/api/a')
    const r = await runScenario(SCEN, d)
    expect(r.ok).toBe(false)
    expect(r.steps).toHaveLength(3)
    expect(r.steps[2]!.ok).toBe(false)
    expect(r.steps[2]!.error).toContain('boom')
    expect(d.calls).toHaveLength(3)
    expect(d.drains).toHaveLength(3)
    // 失败步的 drain：无精确 stepId（SP7——失败时刻无法确认归因）
    expect(d.drains[2]).toEqual({ scenarioId: 's1' })
  })

  it('step id 显式提供时优先（SP2）', async () => {
    const d = fakeDriver()
    const scen: Scenario = { id: 's2', name: 'n', steps: [{ type: 'goto', url: '/x', id: 'open-x' }] }
    const r = await runScenario(scen, d)
    expect(r.steps[0]!.stepId).toBe('open-x')
  })
})

describe('stepIdOf（SP2）', () => {
  it('显式 id 优先，否则 scenarioId-step-index', () => {
    expect(stepIdOf('s', { type: 'goto', url: 'x', id: 'my-id' }, 3)).toBe('my-id')
    expect(stepIdOf('s', { type: 'goto', url: 'x' }, 3)).toBe('s-step-3')
  })
})

describe('runScenarioSuite（纯池调度）', () => {
  it('concurrency 限流 + 结果保持输入顺序', async () => {
    let inFlight = 0
    let peak = 0
    const r: ScenarioRunResult[] = await runScenarioSuite(
      [1, 2, 3, 4, 5].map((n) => ({ scenario: { ...SCEN, id: `s${n}` } as Scenario, ctx: n })),
      {
        concurrency: 2,
        worker: async (item) => {
          inFlight++
          peak = Math.max(peak, inFlight)
          await new Promise((res) => setTimeout(res, 5))
          inFlight--
          return { scenarioId: `s${item.ctx}`, ok: true, steps: [] }
        },
      },
    )
    expect(peak).toBeLessThanOrEqual(2)
    expect(r.map((x) => x.scenarioId)).toEqual(['s1', 's2', 's3', 's4', 's5'])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `PATH=...:$PATH npx vitest run packages/scenario`
Expected: FAIL —— `../runner` 不存在

- [ ] **Step 3: 实现 runner.ts**

```ts
/**
 * Scenario 纯逻辑执行（spec S6/S8/E5 + SP5/SP7）：
 * runScenario —— 步进 + 每步 drain 归因 + fail-fast（失败也 drain，失败步不带精确 stepId）。
 * runScenarioSuite —— 纯 worker 池调度（浏览器生命周期在 playwright-runner，SP4 分层）。
 */
import type { Scenario, ScenarioStep } from './dsl-schema.js'

export interface StepDriver {
  goto(url: string): Promise<void>
  waitFor(selector: string, timeoutMs?: number): Promise<void>
  waitForRequest(urlPattern: string, timeoutMs?: number): Promise<void>
  assertFieldVisible(field: string, timeoutMs?: number): Promise<void>
  screenshot(path?: string): Promise<void>
  /** 每步后由 runner 调用：plugin 侧 drainBrowserCollector + 归因打标（SP6） */
  drain(tag: { scenarioId: string; dslStepId?: string }): Promise<void>
}

export interface StepResult {
  stepId: string
  type: ScenarioStep['type']
  ok: boolean
  durationMs: number
  error?: string
}

export interface ScenarioRunResult {
  scenarioId: string
  ok: boolean
  steps: StepResult[]
}

/** SP2：显式 step id 优先，缺省 scenarioId-step-index */
export function stepIdOf(scenarioId: string, step: ScenarioStep, index: number): string {
  return step.id ?? `${scenarioId}-step-${index}`
}

export async function runScenario(scenario: Scenario, driver: StepDriver): Promise<ScenarioRunResult> {
  const steps: StepResult[] = []
  let ok = true
  for (let i = 0; i < scenario.steps.length; i++) {
    const step = scenario.steps[i]!
    const stepId = stepIdOf(scenario.id, step, i)
    const isWaitRequest = step.type === 'waitForRequest'
    const started = Date.now()
    let stepOk = true
    let error: string | undefined
    try {
      switch (step.type) {
        case 'goto':
          await driver.goto(step.url)
          break
        case 'waitFor':
          await driver.waitFor(step.selector, step.timeoutMs)
          break
        case 'waitForRequest':
          await driver.waitForRequest(step.urlPattern, step.timeoutMs)
          break
        case 'assertFieldVisible':
          await driver.assertFieldVisible(step.field, step.timeoutMs)
          break
        case 'screenshot':
          await driver.screenshot(step.path)
          break
      }
    } catch (err) {
      stepOk = false
      error = (err as Error).message
    }
    const result: StepResult = { stepId, type: step.type, ok: stepOk, durationMs: Date.now() - started, ...(error !== undefined ? { error } : {}) }
    steps.push(result)
    // SP5：waitForRequest 步 drain 带精确 dslStepId；SP7：失败步不带（失败时刻无法确认归因）
    if (!stepOk) {
      await driver.drain({ scenarioId: scenario.id })
      ok = false
      break
    }
    await driver.drain({ scenarioId: scenario.id, ...(isWaitRequest ? { dslStepId: stepId } : {}) })
  }
  return { scenarioId: scenario.id, ok, steps }
}

export interface SuiteItem<Ctx> {
  scenario: Scenario
  ctx: Ctx
}

export async function runScenarioSuite<Ctx>(
  items: ReadonlyArray<SuiteItem<Ctx>>,
  opts: { concurrency: number; worker: (item: SuiteItem<Ctx>) => Promise<ScenarioRunResult> },
): Promise<ScenarioRunResult[]> {
  const results = new Array<ScenarioRunResult>(items.length)
  let next = 0
  const concurrency = Math.max(1, Math.min(opts.concurrency, items.length))
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const idx = next++
      if (idx >= items.length) return
      results[idx] = await opts.worker(items[idx]!)
    }
  })
  await Promise.all(workers)
  return results
}
```

`index.ts` 导出行追加：`export { runScenario, runScenarioSuite, stepIdOf, type StepDriver, type StepResult, type ScenarioRunResult, type SuiteItem } from './runner.js'`

- [ ] **Step 4: 跑测试确认通过**

Run: `PATH=...:$PATH npx vitest run packages/scenario`
Expected: 14 用例 PASS

- [ ] **Step 5: 提交**

```bash
git add packages/scenario
git commit -m "feat(scenario): runner 纯逻辑 —— 步进 fail-fast + drain 归因 + 套件池调度（E5/SP5/SP7）"
```

---

### Task 4: playwright-runner — StepDriver 实现 + hasChromium 迁入 + 浏览器套件入口

**Files:**
- Create: `packages/scenario/src/playwright-runner.ts`
- Modify: `packages/plugin-playwright/src/runner.ts`（hasChromium 迁出 → re-export）
- Modify: `packages/scenario/src/index.ts`
- Test: `packages/scenario/src/__tests__/playwright-runner.test.ts`

**Interfaces:**
- Consumes: T3 的 `StepDriver`/`runScenario`/`runScenarioSuite`、T1 的 `Scenario`
- Produces（T6/T7 依赖）:
  - `hasChromium(): Promise<boolean>`（自 plugin-playwright **逐字迁移**函数体；plugin-playwright 原 runner.ts 改为 `export { hasChromium } from '@nx-mk/scenario'`——其 index.ts 若直接从 './runner.js' 导出则不变自动透传）
  - `createPlaywrightDriver(page: Page): StepDriver`——goto=`page.goto(url,{waitUntil:'networkidle'})`（legacy collect 同语义）；waitFor=`page.waitForSelector(selector,{timeout: timeoutMs ?? 15000})`；waitForRequest=`page.waitForRequest((u) => String(u).includes(urlPattern), {timeout: timeoutMs ?? 15000})`（SP5）；assertFieldVisible=`page.waitForSelector(\`[data-mk-field="${field}"]\`, {state:'visible', timeout: timeoutMs ?? 15000})`；screenshot=`page.screenshot({path, fullPage:true})`（path 缺省 → buffer 丢弃式校验截图可行性）；drain= Promise.resolve()（浏览器驱动自身无 drain 语义——真实 drain 由 T6 observers 在 suite 层包装）
  - `interface SuiteObservers { afterGoto?(scenarioId: string, page: Page, url: string): Promise<void>; afterStep?(scenarioId: string, tag: { scenarioId: string; dslStepId?: string }): Promise<void> }`
  - `runScenarioWithPage(scenario: Scenario, page: Page, observers?: SuiteObservers): Promise<ScenarioRunResult>`——createPlaywrightDriver 包装：goto 后调 observers.afterGoto；drain 实现为 observers.afterStep?.(tag)（无 observers 则 no-op）
  - `runScenarioSuiteInBrowser(scenarios: ReadonlyArray<Scenario>, opts: { concurrency: number; observers?: SuiteObservers }): Promise<ScenarioRunResult[]>`——chromium.launch 一次 → worker 池（T3 runScenarioSuite）每 worker newContext+newPage → runScenarioWithPage → context.close；结束 browser.close（SP4）

- [ ] **Step 1: 写失败测试**

`packages/scenario/src/__tests__/playwright-runner.test.ts`（mock page 对象，不起真浏览器）：

```ts
/**
 * playwright StepDriver 映射 + runScenarioWithPage observers 接线（SP5/SP6）。
 * mock page 只验证驱动调用形状；真浏览器链路由 T6/T7 的套件/回放集成覆盖。
 */
import { describe, it, expect } from 'vitest'
import { createPlaywrightDriver, runScenarioWithPage, type SuiteObservers } from '../playwright-runner'
import type { Scenario } from '../dsl-schema'
import type { Page } from 'playwright-core'

function fakePage() {
  const calls: Array<{ op: string; args: unknown[] }> = []
  const page = {
    goto: async (url: string, o?: unknown) => {
      calls.push({ op: 'goto', args: [url, o] })
    },
    waitForSelector: async (sel: string, o?: unknown) => {
      calls.push({ op: 'waitForSelector', args: [sel, o] })
    },
    waitForRequest: async (pred: unknown, o?: unknown) => {
      calls.push({ op: 'waitForRequest', args: [pred, o] })
    },
    screenshot: async (o?: unknown) => {
      calls.push({ op: 'screenshot', args: [o] })
    },
  }
  return { page: page as unknown as Page, calls }
}

describe('createPlaywrightDriver（5 step 映射）', () => {
  it('goto 带 networkidle；waitFor 缺省 15000ms', async () => {
    const { page, calls } = fakePage()
    const d = createPlaywrightDriver(page)
    await d.goto('/a')
    await d.waitFor('[x]')
    expect(calls[0]).toEqual({ op: 'goto', args: ['/a', { waitUntil: 'networkidle' }] })
    expect(calls[1]!.args[1]).toEqual({ timeout: 15000 })
  })

  it('waitForRequest 谓词 = String(url).includes(urlPattern)（SP5）', async () => {
    const { page, calls } = fakePage()
    const d = createPlaywrightDriver(page)
    await d.waitForRequest('/api/users', 3000)
    const [op, args] = calls[0]!
    expect(op).toBe('waitForRequest')
    const pred = args[0] as (u: unknown) => boolean
    expect(pred({ toString: () => 'http://x/api/users/1' })).toBe(true)
    expect(pred({ toString: () => 'http://x/api/orders' })).toBe(false)
    expect(args[1]).toEqual({ timeout: 3000 })
  })

  it('assertFieldVisible 定位 data-mk-field + state visible', async () => {
    const { page, calls } = fakePage()
    const d = createPlaywrightDriver(page)
    await d.assertFieldVisible('user.name')
    expect(calls[0]!.args[0]).toBe('[data-mk-field="user.name"]')
    expect(calls[0]!.args[1]).toEqual({ state: 'visible', timeout: 15000 })
  })
})

describe('runScenarioWithPage（SP6 observers 接线）', () => {
  it('goto 后 afterGoto / 每步后 afterStep 带 tag；waitForRequest 精确 stepId', async () => {
    const { page } = fakePage()
    const gotos: string[] = []
    const tags: Array<{ scenarioId: string; dslStepId?: string }> = []
    const observers: SuiteObservers = {
      afterGoto: async (_sid, _page, url) => {
        gotos.push(url)
      },
      afterStep: async (_sid, tag) => {
        tags.push(tag)
      },
    }
    const scen: Scenario = {
      id: 's',
      name: 'n',
      steps: [{ type: 'goto', url: '/a' }, { type: 'waitForRequest', urlPattern: '/api' }],
    }
    const r = await runScenarioWithPage(scen, page, observers)
    expect(r.ok).toBe(true)
    expect(gotos).toEqual(['/a'])
    expect(tags[1]).toEqual({ scenarioId: 's', dslStepId: 's-step-1' })
  })

  it('无 observers → 全程 no-op 照常跑通（replay 路径）', async () => {
    const { page } = fakePage()
    const scen: Scenario = { id: 's', name: 'n', steps: [{ type: 'goto', url: '/a' }, { type: 'screenshot' }] }
    const r = await runScenarioWithPage(scen, page)
    expect(r.ok).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `PATH=...:$PATH npx vitest run packages/scenario`
Expected: FAIL —— `../playwright-runner` 不存在

- [ ] **Step 3: 实现 playwright-runner.ts + hasChromium 迁移**

`packages/scenario/src/playwright-runner.ts`：

```ts
/**
 * playwright-core 驱动（spec SP4/SP5/SP6）：
 * createPlaywrightDriver —— StepDriver 的 page 级实现（5 step 映射，legacy collect 同语义）。
 * runScenarioWithPage —— 单场景 + observers 接线（afterGoto=扫描缝 / afterStep=drain 缝）。
 * runScenarioSuiteInBrowser —— 单 browser 多 context 池（S10 并发真实实现）。
 * hasChromium 自 plugin-playwright 迁入（依赖方向 plugin-playwright → scenario，S4）。
 */
import { chromium } from 'playwright-core'
import type { Browser, Page } from 'playwright-core'
import type { Scenario } from './dsl-schema.js'
import { runScenario, runScenarioSuite, type StepDriver, type ScenarioRunResult } from './runner.js'

/** chromium 可用性探针（自 plugin-playwright/src/runner.ts 逐字迁移——迁移时以源文件现体为准） */
export async function hasChromium(): Promise<boolean> {
  // ← 实现者：把 packages/plugin-playwright/src/runner.ts 的 hasChromium 函数体逐字粘贴在此
}

export const DEFAULT_STEP_TIMEOUT_MS = 15000

export function createPlaywrightDriver(page: Page): StepDriver {
  return {
    goto: (url) => page.goto(url, { waitUntil: 'networkidle' }).then(() => undefined),
    waitFor: (selector, timeoutMs) => page.waitForSelector(selector, { timeout: timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS }).then(() => undefined),
    // SP5：谓词 = URL 子串包含（零依赖、demo 粒度够用）
    waitForRequest: (urlPattern, timeoutMs) =>
      page.waitForRequest((u) => String(u).includes(urlPattern), { timeout: timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS }).then(() => undefined),
    assertFieldVisible: (field, timeoutMs) =>
      page.waitForSelector(`[data-mk-field="${field}"]`, { state: 'visible', timeout: timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS }).then(() => undefined),
    screenshot: (path) => page.screenshot(path !== undefined ? { path, fullPage: true } : { fullPage: true }).then(() => undefined),
    // 驱动自身无 drain 语义——真实 drain 由 runScenarioWithPage 的 observers 包装（SP6）
    drain: () => Promise.resolve(),
  }
}

export interface SuiteObservers {
  /** goto 完成后（plugin 侧：PAGE_SCAN → field-hit emitReport，SP6） */
  afterGoto?(scenarioId: string, page: Page, url: string): Promise<void>
  /** 每步 drain 时点（plugin 侧：drainBrowserCollector + 归因 tag，SP6） */
  afterStep?(scenarioId: string, tag: { scenarioId: string; dslStepId?: string }): Promise<void>
}

export async function runScenarioWithPage(scenario: Scenario, page: Page, observers?: SuiteObservers): Promise<ScenarioRunResult> {
  const inner = createPlaywrightDriver(page)
  const driver: StepDriver = {
    ...inner,
    goto: async (url) => {
      await inner.goto(url)
      if (observers?.afterGoto) await observers.afterGoto(scenario.id, page, url)
    },
    drain: async (tag) => {
      if (observers?.afterStep) await observers.afterStep(scenario.id, tag)
    },
  }
  return runScenario(scenario, driver)
}

export async function runScenarioSuiteInBrowser(
  scenarios: ReadonlyArray<Scenario>,
  opts: { concurrency: number; observers?: SuiteObservers },
): Promise<ScenarioRunResult[]> {
  const browser: Browser = await chromium.launch()
  try {
    return await runScenarioSuite(
      scenarios.map((scenario) => ({ scenario, ctx: 0 })),
      {
        concurrency: opts.concurrency,
        worker: async (item) => {
          const context = await browser.newContext()
          try {
            const page = await context.newPage()
            return await runScenarioWithPage(item.scenario, page, opts.observers)
          } finally {
            await context.close()
          }
        },
      },
    )
  } finally {
    await browser.close()
  }
}
```

`packages/plugin-playwright/src/runner.ts`：删除原 `hasChromium` 函数体，原位改为：

```ts
// S4：hasChromium 迁入 @nx-mk/scenario（依赖方向 plugin-playwright → scenario）；re-export 向后兼容
export { hasChromium } from '@nx-mk/scenario'
```

（若 plugin-playwright 其他模块从 './runner.js' 深导入 hasChromium，re-export 后不变。同时给 plugin-playwright 加依赖 `@nx-mk/scenario: workspace:*` 并 `pnpm install`。）`index.ts` 追加：`export { globToRegExp, loadScenarios, ... }`（各任务已加）+ 本任务：`export { hasChromium, createPlaywrightDriver, runScenarioWithPage, runScenarioSuiteInBrowser, type SuiteObservers } from './playwright-runner.js'` 及 runner 的 T3 导出（合并为完整导出块，注意 ≤ 行数）。

- [ ] **Step 4: 跑测试确认通过 + 两包回归**

Run: `PATH=...:$PATH npx vitest run packages/scenario packages/plugin-playwright && PATH=...:$PATH pnpm --filter @nx-mk/scenario build && PATH=...:$PATH pnpm -r typecheck`
Expected: scenario 19 用例 PASS；plugin-playwright 既有全绿（hasChromium re-export 透传）；typecheck 全绿

- [ ] **Step 5: 提交**

```bash
git add packages/scenario packages/plugin-playwright pnpm-lock.yaml
git commit -m "feat(scenario): playwright-runner —— StepDriver 映射 + observers 接线 + 多 context 套件池（SP4/SP5/SP6/S10）+ hasChromium 迁入"
```

---

### Task 5: config scenarios 段 + trace 归因字段 + db 两列 + drain tag 参数

**Files:**
- Modify: `packages/config/src/schema.ts`（ScenarioConfigSchema + ConfigSchema.scenarios + 导出）+ `index.ts`
- Modify: `packages/client/src/collector/collector.ts:16-26`（RequestTraceCore 两字段）
- Modify: `packages/coverage/src/db/client.ts:78-91`（INSERT 两列）
- Modify: `packages/plugin-playwright/src/scanner.ts`（drainBrowserCollector 第三参 tag）
- Test: `packages/config/src/__tests__/scenario-schema.test.ts`（新）+ `packages/coverage/src/__tests__` 内既有 db 测试扩展（找 `flushDrained` 或 traces 相关测试文件追加 1 用例）

**Interfaces:**
- Produces:
  - `ScenarioConfigSchema = z.object({ include: z.array(z.string().min(1)).optional(), concurrency: z.number().int().min(1).max(10).optional() })`，`ConfigSchema.scenarios: ScenarioConfigSchema.optional()`，导出 `type ScenarioConfig`
  - `RequestTraceCore` 增 `scenarioId?: string; dslStepId?: string`
  - `drainBrowserCollector(evaluate, collector, tag?: { scenarioId: string; dslStepId?: string })`——tag 存在时该批 trace 逐条附 `scenarioId`（dslStepId 仅 tag.dslStepId 存在时附）；hits 不打标（FieldHitCore 无此字段，spec S6）

- [ ] **Step 1: 写失败测试**

`packages/config/src/__tests__/scenario-schema.test.ts`：

```ts
/**
 * config scenarios 段（spec §10 原文口径）：include/concurrency 解析 + 上限门 + 缺省可缺席。
 */
import { describe, it, expect } from 'vitest'
import { ConfigSchema, ScenarioConfigSchema } from '../schema'

describe('ScenarioConfigSchema', () => {
  it('include + concurrency 解析；concurrency 0/11 拒绝', () => {
    expect(ScenarioConfigSchema.parse({ include: ['mk/scenarios/**/*.yml'], concurrency: 3 })).toEqual({
      include: ['mk/scenarios/**/*.yml'],
      concurrency: 3,
    })
    expect(() => ScenarioConfigSchema.parse({ include: ['x'], concurrency: 0 })).toThrow()
    expect(() => ScenarioConfigSchema.parse({ include: ['x'], concurrency: 11 })).toThrow()
  })

  it('ConfigSchema.scenarios 可缺席（向后兼容）→ 提供时透传', () => {
    expect(ConfigSchema.parse({}).scenarios).toBeUndefined()
    const parsed = ConfigSchema.parse({ scenarios: { include: ['a.yml'] } })
    expect(parsed.scenarios).toEqual({ include: ['a.yml'] })
  })
})
```

db 测试扩展：在 coverage 包既有 db/flush 测试文件（`grep -rln "flushDrained" packages/coverage/src --include="*.test.ts"` 定位）追加一用例：

```ts
it('trace 带归因字段时落 scenario_id/dsl_step_id 两列（spec S6）', () => {
  // 构造 d.traces 含 { requestId: 'r1', method: 'GET', url: '/a', scenarioId: 's1', dslStepId: 's1-step-0' }
  // flushDrained 后查询 request_traces 该行，断言 scenario_id='s1' && dsl_step_id='s1-step-0'
  // 既有用例（无归因字段）应仍落 NULL —— 若同文件已有 NULL 基线用例则免重复
})
```

（以目标文件既有 fixture 风格补全构造细节；断言必须有真实 SQL 读回，禁止只测 prepare 不测值。）

- [ ] **Step 2: 跑测试确认失败**

Run: `PATH=...:$PATH npx vitest run packages/config packages/coverage`
Expected: FAIL —— `ScenarioConfigSchema` 不存在；归因用例两列仍 NULL

- [ ] **Step 3: 实现**

**config/src/schema.ts**（AgentConfigSchema 之后、ConfigSchema 之前插入）：

```ts
// §26：可选 scenarios 段（spec S1/S10 —— include 非空激活套件模式；concurrency 默认 3 上限 10）
export const ScenarioConfigSchema = z.object({
  include: z.array(z.string().min(1)).optional(),
  concurrency: z.number().int().min(1).max(10).optional(),
})
export type ScenarioConfig = z.infer<typeof ScenarioConfigSchema>
```

ConfigSchema 内 `dashboard: DashboardConfigSchema.optional(),` 行后追加 `scenarios: ScenarioConfigSchema.optional(),`（带同款中文注释）；config `index.ts` 导出 `ScenarioConfigSchema, type ScenarioConfig`。

**client/src/collector/collector.ts** RequestTraceCore 末尾（`endedAt?: string` 后）追加：

```ts
  /** §26 归因（S6）：套件模式 drain 时打标；legacy collect 恒缺席 */
  scenarioId?: string
  dslStepId?: string
```

**coverage/src/db/client.ts**：INSERT 列 `(?, ?, ?, NULL, NULL, ...)` 的两个 NULL 改 `?, ?`，`insTrace.run(...)` 在 `t.requestId` 后追加 `t.scenarioId ?? null, t.dslStepId ?? null,`（参数序与列序严格对齐——列序 scenario_id, dsl_step_id 在 trace_id 之后 endpoint_id 之前，核对再插）。

**plugin-playwright/src/scanner.ts**：`drainBrowserCollector(evaluate, collector)` 加第三参：

```ts
export interface DrainTag {
  scenarioId: string
  dslStepId?: string
}

export async function drainBrowserCollector(
  evaluate: (fn: unknown) => Promise<unknown>,
  collector: Collector,
  tag?: DrainTag,
): Promise<void> {
```

trace 投递处（现 `collector.trace({...})` 调用）：构造 trace 对象后，tag 存在时附 `scenarioId: tag.scenarioId`，`tag.dslStepId !== undefined` 时附 `dslStepId: tag.dslStepId`（实现者读现函数体 trace 构造点，以展开字段方式并入，不整对象覆盖）。

- [ ] **Step 4: 跑测试确认通过 + 跨包构建 + typecheck**

Run: `PATH=...:$PATH pnpm --filter @nx-mk/client build && PATH=...:$PATH pnpm --filter @nx-mk/coverage build && PATH=...:$PATH pnpm -r typecheck && PATH=...:$PATH npx vitest run packages/config packages/coverage packages/client packages/plugin-playwright`
Expected: 全绿（运维缝：client/coverage dist 刷新后下游才见新字段）

- [ ] **Step 5: 提交**

```bash
git add packages/config packages/client packages/coverage packages/plugin-playwright
git commit -m "feat(config/coverage): scenarios 段 + RequestTraceCore 归因字段 + db 两列 + drain tag（S6）"
```

---

### Task 6: plugin-playwright 套件模式 — beforeRun 分叉 + observers + 事件 + E8

**Files:**
- Modify: `packages/kernel/src/event-bus.ts:12-15`（KernelEvent union + 两事件）
- Modify: `packages/plugin-playwright/src/index.ts`（beforeRun 分叉；现文件 ~180 行，套件分支 +~90 行 → 预计 ~280 行，≤400 达标）
- Modify: `packages/plugin-playwright/package.json`（+ `@nx-mk/scenario: workspace:*`，pnpm install）
- Test: `packages/plugin-playwright/src/__tests__/suite-mode.test.ts`（新——mock 侧不起真浏览器：把 browser 生命周期抽出可注入）

**Interfaces:**
- Consumes: T2 `loadScenarios`、T4 `runScenarioSuiteInBrowser`/`SuiteObservers`、T5 `DrainTag`
- Produces:
  - kernel 事件 `{ type: 'scenario:start'; scenarioId: string; timestamp: string }` / `{ type: 'scenario:done'; scenarioId: string; ok: boolean; timestamp: string }`
  - beforeRun 分叉语义（E2/E3/E8 全落此任务）；测试注入缝：`PlaywrightPluginOptions` 增 `suiteRunner?: (scenarios, opts: { concurrency: number; observers: SuiteObservers }) => Promise<ScenarioRunResult[]>`（缺省真实现——**可注入是本任务可测性的关键缝**）

- [ ] **Step 1: kernel 事件 union**

`packages/kernel/src/event-bus.ts` union 末尾（`plugin:loaded` 行后）追加：

```ts
  | { type: 'scenario:start'; scenarioId: string; timestamp: string }
  | { type: 'scenario:done'; scenarioId: string; ok: boolean; timestamp: string }
```

（kernel 构建刷新 dist。若 union 有 exhaustive switch/assert-never 消费者编译报错，按新成员补分支——先 `pnpm -r typecheck` 找出全部消费点。）

- [ ] **Step 2: 写失败测试**

`packages/plugin-playwright/src/__tests__/suite-mode.test.ts`：

```ts
/**
 * 套件模式分叉（spec E2/E3/E8/S9/SP3）：scenarios 配置门 / 0 命中回落 legacy / 归因 observers / 失败汇总。
 * suiteRunner 注入 —— 测试不起真浏览器（SP4 缝）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPlaywrightPlugin } from '../index'
import { createCollector } from '@nx-mk/client/collector'
import type { Plugin, PluginContext } from '@nx-mk/kernel'

const SCEN_YAML = `version: 1
scenarios:
  - id: s-ok
    name: ok
    steps:
      - type: goto
        url: /a
  - id: s-bad
    name: bad
    steps:
      - type: assertFieldVisible
        field: nope.missing
`

function makeCtx(config: Record<string, unknown>, log: string[]): PluginContext {
  // 以 plugin-assembly.test.ts 的 makeCtx 为模板（含 events emit 记录 / emitReport 收集 / getTurn=1 / logger.push）
  // ← 实现者：复制同目录既有测试的 ctx 构造，追加 log 行收集
}

describe('beforeRun 套件模式', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nx-mk-suite-'))
    mkdirSync(join(dir, 'mk/scenarios'), { recursive: true })
    writeFileSync(join(dir, 'mk/scenarios/s.yml'), SCEN_YAML, 'utf8')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function plugin(suiteImpl?: Parameters<NonNullable<Parameters<typeof createPlaywrightPlugin>[0]['suiteRunner']>>[0] extends never ? never : never): Plugin {
    throw new Error('placeholder — see Step 3 note')
  }

  it('E3 语义注入位：suiteRunner 缺省真实现被调用且 observers.afterStep 收到归因 tag', async () => {
    // 以注入 suiteRunner 的假实现断言收到的 scenarios ids = ['s-ok','s-bad']、concurrency=3 缺省
    // 真实现链路（chromium）不在单测域 —— E3 chromium fail-fast 用例沿用既有 collect 模式测试的同款注入手法
  })
})
```

**实现者注（本 brief 的测试骨架是形状契约，不是逐字终稿）**：同目录既有 `plugin.test.ts`（v1 已补 `plugins: []` 的那份，包根 `__tests__/`）是 ctx 构造与 inject 手法的**唯一权威模板**——读取它，沿用其 makeCtx/logger/kernel stub 手法，把上面 4 条语义断言补成真测试：(1) `scenarios.include` 非空 → suiteRunner 被调、参数 ids 正确、concurrency 缺省 3；(2) `loadScenarios` 0 命中（include 指向不存在目录）→ suiteRunner 不被调、走 legacy collect 分支（以 collect.url 消费为证）；(3) suiteRunner 返回含 `ok:false` 结果 → E8 warn 被调用且含失败 id、ctx.events 收到 `scenario:done`（ok:false）；(4) observers.afterStep 被 suiteRunner 真实现消费的归因形状——此条通过对注入假 suiteRunner 调用其 `opts.observers.afterStep('x', {scenarioId:'x'})` 并断言 collector.trace 收到带 scenarioId 的 trace 完成闭环。禁止保留 `throw new Error('placeholder')` 提交。

- [ ] **Step 3: 跑测试确认失败**

Run: `PATH=...:$PATH npx vitest run packages/plugin-playwright`
Expected: FAIL —— suiteRunner 选项不存在/套件分支不存在

- [ ] **Step 4: 实现 beforeRun 分叉**

`index.ts` 顶部 import 追加（全部 static——workspace 依赖已在 T4 落）：

```ts
import { loadScenarios, runScenarioSuiteInBrowser, type SuiteObservers, type ScenarioRunResult } from '@nx-mk/scenario'
import type { ScenarioConfig } from '@nx-mk/config'
```

`PlaywrightPluginOptions` 增：

```ts
  /** 测试注入缝（SP4）：套件执行器；缺省 = runScenarioSuiteInBrowser 真实现 */
  suiteRunner?: (scenarios: ReadonlyArray<import('@nx-mk/scenario').Scenario>, opts: { concurrency: number; observers: SuiteObservers }) => Promise<ScenarioRunResult[]>
```

beforeRun 改造（保持既有 legacy 路径逐字不动，仅包一层分支）：

```ts
      async beforeRun(ctx) {
        const cmd = ctx.kernel.getSubcommand()
        if (cmd !== 'run' && cmd !== 'doctor') return
        const config = ctx.config as ResolvedConfig
        const collect = (ctx.config as typeof ctx.config & { collect?: CollectConfig }).collect
        const scenariosCfg = (ctx.config as typeof ctx.config & { scenarios?: ScenarioConfig }).scenarios
        const hasOwnEntry = ...
        // §26 分叉：scenarios.include 非空 → 套件模式；否则 legacy collect（含 E2 回落）
        if (scenariosCfg?.include?.length) {
          await this.runSuite(ctx, scenariosCfg, collect)
          return
        }
        // …（既有 collect 门/chromium 门/launchCollect/emitReport 全体逐字保留）
      },
```

新增私有方法 `runSuite(ctx, cfg, collect)`（挂在 hooks 对象外的工厂闭包内，非 hooks 键——以插件对象方法组织，实现者自定，语义如下）：

```ts
        // E2：0 命中 → warn + 回落 legacy collect
        const cwd = typeof ctx.cwd === 'string' ? ctx.cwd : process.cwd()
        const { scenarios, skipped } = loadScenarios(cwd, cfg.include ?? [])
        for (const s of skipped) ctx.logger.warn(`plugin-playwright: scenario skipped — ${s}`)
        if (scenarios.length === 0) {
          ctx.logger.warn('plugin-playwright: scenarios.include matched 0 files — falling back to legacy collect')
          return this.legacyCollect(ctx, collect)   // legacy 路径抽成方法复用
        }
        // E3：chromium fail-fast（与 legacy 同错误码同文案风格）
        if (!(await hasChromium())) throw new KernelError('PLUGIN_HOOK_FAILED', 'plugin-playwright: chromium browser not available — run `npx playwright install chromium` first')
        const collector = this.collector   // 工厂闭包内的共享 collector
        const observers: SuiteObservers = {
          afterGoto: async (_sid, page, url) => {
            // SP6：与 legacy 逐字同语义的 DOM 扫描 → field-hit emitReport（复用既有 scanPage + toReport 逻辑）
          },
          afterStep: async (sid, tag) => {
            // S6：drain + 归因（T5 的 tag 参数）
            await drainBrowserCollector((fn) => page.evaluate(fn as never), collector, tag)  // page 从闭包不可得——见下
          },
        }
```

**page 可得性裁定（实现者按此落）**：`afterStep` 需要页上下文做 evaluate——`runScenarioSuiteInBrowser` 的 observers 接口不透传 page。解决：本插件不直接用 `runScenarioSuiteInBrowser` 的缺省 observers 形状，而是把 drain 并入 `afterGoto`？不行——归因粒度是步。改 T4 接口：`SuiteObservers.afterStep(scenarioId, tag, page: Page)` **第三参透传 page**（T4 接口微调，回改 T4 签名并同步其测试——若 T4 已合并则本任务一并改，属接口演进非返工）。suiteRunner 注入缺省：

```ts
        const turn = ctx.getTurn()
        const runner = opts.suiteRunner ?? runScenarioSuiteInBrowser
        const results = await runner(scenarios.map((s) => s.scenario), { concurrency: cfg.concurrency ?? 3, observers })
        for (const r of results) {
          ctx.events.emit({ type: 'scenario:done', scenarioId: r.scenarioId, ok: r.ok, timestamp: new Date().toISOString() })
          // SP3：snapshot 增量幂等，逐场景 flush 新增量
          for (const rep of collector.snapshot(turn)) ctx.emitReport(toReport(rep, turn))
        }
        // E8：失败汇总（退出码 0）
        const failed = results.filter((r) => !r.ok)
        if (failed.length > 0) {
          ctx.logger.warn(`plugin-playwright: ${failed.length}/${results.length} scenarios failed — [${failed.map((f) => f.scenarioId).join(', ')}]`)
        }
```

且套件启动前对每场景 emit `scenario:start`（在 runner 调用前逐个 emit——顺序 start 全部 → 执行 → done 逐个，或注入 suiteRunner 包装；裁定：**start 在调用 runner 前 for 循环全量 emit**，语义 = 批次开始，简单诚实）。afterGoto 扫描失败容错：与 legacy 同款 try/warn（不抛）。

- [ ] **Step 5: 跑测试确认通过 + kernel/plugin 构建 + 全链 typecheck**

Run: `PATH=...:$PATH pnpm --filter @nx-mk/kernel build && PATH=...:$PATH pnpm --filter @nx-mk/scenario build && PATH=...:$PATH pnpm --filter @nx-mk/plugin-playwright build && PATH=...:$PATH pnpm -r typecheck && PATH=...:$PATH npx vitest run packages/plugin-playwright packages/kernel`
Expected: 全绿；kernel 既有事件消费者（SSE event-tail 等）零回归（新事件类型不映射——spec S9 裁定）

- [ ] **Step 6: 提交**

```bash
git add packages/kernel/src/event-bus.ts packages/plugin-playwright pnpm-lock.yaml
git commit -m "feat(plugin-playwright): beforeRun 套件模式分叉 —— loadScenarios + observers 归因 + 逐场景 snapshot + E2/E3/E8（S6/S9/SP3/SP6）"
```

---

### Task 7: scenario-replay — replayScenario + trail 写盘

**Files:**
- Create: `packages/scenario/src/scenario-replay.ts`
- Modify: `packages/scenario/src/index.ts`
- Test: `packages/scenario/src/__tests__/scenario-replay.test.ts`

**Interfaces:**
- Consumes: T4 `hasChromium`/`runScenarioWithPage`
- Produces（T8 直接消费）:
  - `class ScenarioReplayError extends Error { code: 'CHROMIUM_MISSING' | 'LAUNCH_FAILED' }`
  - `interface ScenarioReplayTrail { replayId: string; scenarioId: string; ok: boolean; steps: StepResult[]; createdAt: string }`
  - `makeScenarioReplayId(scenarioId: string): string`（`${scenarioId}-${Date.now()}`，对齐 request replay 风格）
  - `writeScenarioReplayTrail(nxMkDir: string, trail: ScenarioReplayTrail): string | null`——写 `.nx-mk/replays/scenarios/<scenarioId>/<replayId>.json`（mkdirSync recursive；失败静默 null，E9）
  - `replayScenario(scenario: Scenario): Promise<ScenarioRunResult>`——hasChromium 缺失抛 `CHROMIUM_MISSING`（E4）；chromium.launch 失败抛 `LAUNCH_FAILED`；单 context+page 跑 `runScenarioWithPage(scenario, page)`（无 observers——replay 不进 coverage 通道，S7）；finally close

- [ ] **Step 1: 写失败测试**

`packages/scenario/src/__tests__/scenario-replay.test.ts`：

```ts
/**
 * replayScenario 浏览器编排（SP4/E4）+ trail 写盘（S12/E9）。
 * chromium 不可达环境（CI/单测）下 CHROMIUM_MISSING 路径即可测——launch 路径以注入缝覆盖。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeScenarioReplayId, writeScenarioReplayTrail, type ScenarioReplayTrail } from '../scenario-replay'
import type { ScenarioRunResult } from '../runner'

describe('makeScenarioReplayId', () => {
  it('scenarioId-时间戳 形状', () => {
    expect(makeScenarioReplayId('s1')).toMatch(/^s1-\d+$/)
  })
})

describe('writeScenarioReplayTrail（S12/E9）', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nx-mk-srep-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('落 replays/scenarios/<scenarioId>/<replayId>.json 且内容 round-trip', () => {
    const trail: ScenarioReplayTrail = {
      replayId: makeScenarioReplayId('s1'),
      scenarioId: 's1',
      ok: true,
      steps: [{ stepId: 's1-step-0', type: 'goto', ok: true, durationMs: 5 }],
      createdAt: '2026-09-21T00:00:00.000Z',
    }
    expect(writeScenarioReplayTrail(dir, trail)).toBe(trail.replayId)
    const back = JSON.parse(readFileSync(join(dir, 'replays/scenarios/s1', `${trail.replayId}.json`), 'utf8')) as ScenarioReplayTrail
    expect(back.scenarioId).toBe('s1')
    expect(back.steps).toHaveLength(1)
  })

  it('E9：不可写路径 → null 不抛', () => {
    const blocker = join(dir, 'file-not-dir')
    writeFileSync(blocker, 'x', 'utf8')
    expect(writeScenarioReplayTrail(join(blocker, 'impossible'), {
      replayId: 'r', scenarioId: 's', ok: true, steps: [], createdAt: 'x',
    })).toBeNull()
  })

  it('同场景多次回放 → 同目录多文件互不覆盖', () => {
    const t1: ScenarioReplayTrail = { replayId: 's1-111', scenarioId: 's1', ok: true, steps: [], createdAt: 'x' }
    const t2: ScenarioReplayTrail = { replayId: 's1-222', scenarioId: 's1', ok: true, steps: [], createdAt: 'x' }
    writeScenarioReplayTrail(dir, t1)
    writeScenarioReplayTrail(dir, t2)
    expect(readdirSync(join(dir, 'replays/scenarios/s1'))).toHaveLength(2)
    expect(existsSync(join(dir, 'replays/scenarios/s1/s1-111.json'))).toBe(true)
  })
})
```

（`replayScenario` 本体的 CHROMIUM_MISSING 路径：追加一用例——在无 chromium 环境下 `await expect(replayScenario(scen)).rejects.toMatchObject({ code: 'CHROMIUM_MISSING' })`；若 CI 机有 chromium 则该用例改为注入缝断言：把 launch 函数提成模块内 `launchBrowser` 常量并导出 setter 或接受 opts.launch 参数——实现者按环境实测定，两种手法取一，报告注明。）

- [ ] **Step 2: 跑测试确认失败 → Step 3: 实现**

`scenario-replay.ts`（写盘两函数 + makeScenarioReplayId 逐 brief；replayScenario）：

```ts
export class ScenarioReplayError extends Error {
  constructor(readonly code: 'CHROMIUM_MISSING' | 'LAUNCH_FAILED', message: string) {
    super(message)
    this.name = 'ScenarioReplayError'
  }
}

/** 单场景回放（spec S3/S7/S12）：read-only 步集无 observers；E4 chromium 门；SP4 浏览器生命周期内聚 */
export async function replayScenario(scenario: Scenario): Promise<ScenarioRunResult> {
  if (!(await hasChromium())) {
    throw new ScenarioReplayError('CHROMIUM_MISSING', 'chromium browser not available — run `npx playwright install chromium` first')
  }
  let browser: Browser
  try {
    browser = await chromium.launch()
  } catch (err) {
    throw new ScenarioReplayError('LAUNCH_FAILED', `chromium launch failed: ${(err as Error).message}`)
  }
  try {
    const context = await browser.newContext()
    try {
      const page = await context.newPage()
      return await runScenarioWithPage(scenario, page)
    } finally {
      await context.close()
    }
  } finally {
    await browser.close()
  }
}
```

（imports：chromium/Browser 自 playwright-core；hasChromium/runScenarioWithPage 自 './playwright-runner.js'；Scenario/ScenarioRunResult/StepResult 各自模块。）

`index.ts` 导出追加。

- [ ] **Step 4: 跑测试确认通过 + 提交**

Run: `PATH=...:$PATH npx vitest run packages/scenario && PATH=...:$PATH pnpm --filter @nx-mk/scenario build`
Expected: 全绿

```bash
git add packages/scenario
git commit -m "feat(scenario): replayScenario 浏览器编排 + ScenarioReplayTrail 写盘（E4/E9/S12/SP4）"
```

---

### Task 8: dashboard — GET /api/scenarios + POST replay/scenario + 串行锁

**Files:**
- Modify: `packages/dashboard/package.json`（+ `"@nx-mk/scenario": "workspace:*"` → `pnpm install`）
- Modify: `packages/dashboard/src/shared/api-types.ts`（末尾追加）
- Create: `packages/dashboard/src/server/routes/scenarios.ts`
- Modify: `packages/dashboard/src/server/index.ts`（registerScenarioRoutes）
- Test: `packages/dashboard/src/__tests__/scenarios-routes.test.ts`（新）

**Interfaces:**
- Consumes: T2 `loadScenarios`、T7 `replayScenario`/`ScenarioReplayError`/`writeScenarioReplayTrail`/`makeScenarioReplayId`、v1 写回链的 `RouteContext.configPath`
- Produces:
  - `GET /api/scenarios` → `ScenariosResponse { enabled: boolean; scenarios: ScenarioView[] }`；`ScenarioView { id, name, route?, stepCount, file }`；configPath 未接线或无 scenarios 段 → `{enabled: false, scenarios: []}`（S11）；E1 跳过文件不出现在列表（loader 已滤）；loadConfig 失败（配置损坏）→ 同降级形状 + 200（诚实空态，不 500——浏览页不该因配置损坏全红）
  - `POST /api/runs/:runId/replay/scenario/:scenarioId` → 200 `ScenarioReplayResponse { replayId, scenarioId, ok, steps: StepResultView[], createdAt, trailWritten: boolean }`；错误矩阵：run 不存在 404（对齐 replay.ts 既有门）/ 场景不存在 404 `unknown scenario`（E7）/ 进行中 409 `scenario replay already in progress`（E6）/ chromium 缺失 409（E4，code CHROMIUM_MISSING）/ LAUNCH_FAILED 500
  - 串行锁：模块级 `let inFlight = false`（try/finally 复位）——单进程 dashboard 本地工具语义

- [ ] **Step 1: 依赖 + 类型**

`package.json` dependencies 按字母序插 `"@nx-mk/scenario": "workspace:*",`，根目录 `pnpm install`。`api-types.ts` 末尾：

```ts
/** GET /api/scenarios（spec S11 —— 无 scenarios 段诚实降级） */
export interface ScenarioView {
  id: string
  name: string
  route?: string
  stepCount: number
  file: string
}
export interface ScenariosResponse {
  enabled: boolean
  scenarios: ScenarioView[]
}

/** POST /api/runs/:runId/replay/scenario/:scenarioId（spec S3/S12） */
export interface StepResultView {
  stepId: string
  type: string
  ok: boolean
  durationMs: number
  error?: string
}
export interface ScenarioReplayResponse {
  replayId: string
  scenarioId: string
  ok: boolean
  steps: StepResultView[]
  createdAt: string
  trailWritten: boolean
}
```

- [ ] **Step 2: 写失败测试**

`packages/dashboard/src/__tests__/scenarios-routes.test.ts`（沿用 plugins-config-routes.test.ts 的 buildServer/inject/fixture 手法）：

```ts
/**
 * GET /api/scenarios（S11 降级）+ POST replay/scenario 矩阵（E4/E6/E7 + SP8）。
 * 真浏览器不在单测域：replayScenario 经 vi.mock('@nx-mk/scenario') 部分替换（见下）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import type { FastifyInstance } from 'fastify'

// 部分替换：loadScenarios 保持真实现（读盘），replayScenario/hasChromium 换假
vi.mock('@nx-mk/scenario', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nx-mk/scenario')>()
  return {
    ...actual,
    replayScenario: vi.fn(),
  }
})

const { buildServer } = await import('../server/index.js')
const { replayScenario, ScenarioReplayError } = await import('@nx-mk/scenario')
import { makeNxMkDir } from './fixtures.js'
import type { ScenariosResponse, ScenarioReplayResponse } from '../shared/api-types.js'

const SCEN_YAML = `version: 1
scenarios:
  - id: s-ok
    name: ok 场景
    route: /users/1
    steps:
      - type: goto
        url: /users/1
      - type: assertFieldVisible
        field: user.name
`

describe('GET /api/scenarios（S11）', () => {
  let dir: string
  let configPath: string
  let app: FastifyInstance
  beforeEach(() => {
    dir = makeNxMkDir([{ runId: 'run_a' }])
    configPath = join(dirname(dir), 'nx-mk.config.yml')
    mkdirSync(join(dirname(dir), 'mk/scenarios'), { recursive: true })
    writeFileSync(join(dirname(dir), 'mk/scenarios/s.yml'), SCEN_YAML, 'utf8')
  })
  afterEach(async () => {
    await app.close()
    rmSync(dirname(dir), { recursive: true, force: true })
  })

  it('有 scenarios 段 → enabled + 场景列表（id/name/route/stepCount/file）', async () => {
    writeFileSync(configPath, 'scenarios:\n  include:\n    - "mk/scenarios/**/*.yml"\n', 'utf8')
    app = buildServer({ nxMkDir: dir, uiDistDir: join(dir, 'ui'), configPath })
    const res = await app.inject({ method: 'GET', url: '/api/scenarios' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as ScenariosResponse
    expect(body.enabled).toBe(true)
    expect(body.scenarios).toHaveLength(1)
    expect(body.scenarios[0]).toMatchObject({ id: 's-ok', name: 'ok 场景', route: '/users/1', stepCount: 2 })
  })

  it('configPath 未接线 / 无 scenarios 段 → {enabled:false, scenarios:[]}', async () => {
    app = buildServer({ nxMkDir: dir, uiDistDir: join(dir, 'ui') })
    const res = await app.inject({ method: 'GET', url: '/api/scenarios' })
    expect(res.json()).toEqual({ enabled: false, scenarios: [] })
    app2 = buildServer({ nxMkDir: dir, uiDistDir: join(dir, 'ui'), configPath })  // 有 configPath 无段
    // （实现者以第二实例或重 build 断言同形状）
  })
})

describe('POST /api/runs/:runId/replay/scenario/:scenarioId', () => {
  // beforeEach 同上 + configPath 写 scenarios 段
  it('全链：200 + 步骤级结果 + trailWritten=true + .nx-mk/replays/scenarios/ 落盘（SP8）', async () => {
    vi.mocked(replayScenario).mockResolvedValue({ scenarioId: 's-ok', ok: true, steps: [{ stepId: 's-ok-step-0', type: 'goto', ok: true, durationMs: 4 }] })
    // run 目录存在（makeNxMkDir [{runId:'run_a'}]）
    const res = await app.inject({ method: 'POST', url: '/api/runs/run_a/replay/scenario/s-ok' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as ScenarioReplayResponse
    expect(body.ok).toBe(true)
    expect(body.steps[0]!.stepId).toBe('s-ok-step-0')
    expect(body.trailWritten).toBe(true)
  })

  it('E7 场景不存在 → 404', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/runs/run_a/replay/scenario/ghost' })
    expect(res.statusCode).toBe(404)
  })

  it('E6 进行中 → 409（用不 resolve 的 promise 占住锁）', async () => {
    let release!: () => void
    vi.mocked(replayScenario).mockImplementation(() => new Promise<void>((r) => { release = r as () => void }))
    const first = app.inject({ method: 'POST', url: '/api/runs/run_a/replay/scenario/s-ok' })
    const second = await app.inject({ method: 'POST', url: '/api/runs/run_a/replay/scenario/s-ok' })
    expect(second.statusCode).toBe(409)
    release()
    expect((await first).statusCode).toBe(200)
  })

  it('E4 chromium 缺失 → 409（ScenarioReplayError CHROMIUM_MISSING）', async () => {
    vi.mocked(replayScenario).mockRejectedValue(new ScenarioReplayError('CHROMIUM_MISSING', 'no chromium'))
    const res = await app.inject({ method: 'POST', url: '/api/runs/run_a/replay/scenario/s-ok' })
    expect(res.statusCode).toBe(409)
  })

  it('LAUNCH_FAILED → 500；run 不存在 → 404', async () => {
    vi.mocked(replayScenario).mockRejectedValue(new ScenarioReplayError('LAUNCH_FAILED', 'x'))
    expect((await app.inject({ method: 'POST', url: '/api/runs/run_a/replay/scenario/s-ok' })).statusCode).toBe(500)
    expect((await app.inject({ method: 'POST', url: '/api/runs/ghost_run/replay/scenario/s-ok' })).statusCode).toBe(404)
  })
})
```

（`app2` 变量未声明的笔误由实现者修正为合法结构——两条降级断言各自 build + inject + close。）

- [ ] **Step 3: 跑测试确认失败**

Run: `PATH=...:$PATH npx vitest run packages/dashboard`
Expected: FAIL —— 404 route-miss

- [ ] **Step 4: 实现 routes/scenarios.ts**

```ts
/**
 * GET /api/scenarios（spec S11）+ POST /api/runs/:runId/replay/scenario/:scenarioId（§27/S3/S12）。
 * 浏览器执行经 @nx-mk/scenario 高层入口（SP4 —— dashboard 零 playwright-core 依赖面）；
 * trail 写盘在 scenario 包（铁律：本目录白名单仍恰 replay.ts）。
 */
import { dirname } from 'node:path'
import type { FastifyInstance } from 'fastify'
import type { RouteContext } from '../types.js'
import { loadScenarios, replayScenario, ScenarioReplayError, makeScenarioReplayId, writeScenarioReplayTrail } from '@nx-mk/scenario'
import { loadConfig } from '@nx-mk/config'
import type { ScenarioReplayResponse, ScenariosResponse } from '../../shared/api-types.js'

// E6：模块级串行锁（单进程本地 dashboard 语义；try/finally 复位）
let inFlight = false

export function registerScenarioRoutes(app: FastifyInstance, ctx: RouteContext): void {
  app.get('/api/scenarios', async (): Promise<ScenariosResponse> => {
    if (!ctx.configPath) return { enabled: false, scenarios: [] }
    try {
      const config = await loadConfig({ path: ctx.configPath, cwd: dirname(ctx.nxMkDir), subcommand: 'start' })
      const include = (config as typeof config & { scenarios?: { include?: string[] } }).scenarios?.include
      if (!include?.length) return { enabled: false, scenarios: [] }
      const { scenarios } = loadScenarios(dirname(ctx.nxMkDir), include)
      return {
        enabled: true,
        scenarios: scenarios.map((s) => ({
          id: s.scenario.id,
          name: s.scenario.name,
          ...(s.scenario.route !== undefined ? { route: s.scenario.route } : {}),
          stepCount: s.scenario.steps.length,
          file: s.file,
        })),
      }
    } catch {
      // 配置损坏 → 浏览页诚实空态（S11 同族），不 500
      return { enabled: false, scenarios: [] }
    }
  })

  app.post('/api/runs/:runId/replay/scenario/:scenarioId', async (req, reply) => {
    const { runId, scenarioId } = req.params as { runId: string; scenarioId: string }
    if (!existsSync(join(ctx.nxMkDir, 'runs', runId))) {
      return reply.code(404).send({ error: `unknown run: ${runId}` })
    }
    if (!ctx.configPath) return reply.code(404).send({ error: `unknown scenario: ${scenarioId}` })
    // 场景定位（每请求现读——GET 与 POST 共享同一 loader 语义）
    let scenario: import('@nx-mk/scenario').Scenario | undefined
    try {
      const config = await loadConfig({ path: ctx.configPath, cwd: dirname(ctx.nxMkDir), subcommand: 'start' })
      const include = (config as typeof config & { scenarios?: { include?: string[] } }).scenarios?.include
      scenario = include?.length ? loadScenarios(dirname(ctx.nxMkDir), include).scenarios.find((s) => s.scenario.id === scenarioId)?.scenario : undefined
    } catch {
      scenario = undefined
    }
    if (!scenario) return reply.code(404).send({ error: `unknown scenario: ${scenarioId}` })
    if (inFlight) return reply.code(409).send({ error: 'scenario replay already in progress' })
    inFlight = true
    try {
      const result = await replayScenario(scenario)
      const trail = {
        replayId: makeScenarioReplayId(scenarioId),
        scenarioId,
        ok: result.ok,
        steps: result.steps,
        createdAt: new Date().toISOString(),
      }
      const written = writeScenarioReplayTrail(ctx.nxMkDir, trail)
      const res: ScenarioReplayResponse = { ...trail, trailWritten: written !== null }
      return res
    } catch (err) {
      if (err instanceof ScenarioReplayError) {
        return reply.code(err.code === 'CHROMIUM_MISSING' ? 409 : 500).send({ error: err.message, code: err.code })
      }
      throw err
    } finally {
      inFlight = false
    }
  })
}
```

（`existsSync` 自 node:fs 导入——实现者补。`loadConfig` 入参形状以 `packages/config/src/loader.ts` 的 `LoadConfigInput` 实际字段为准校正——start.ts 已有先例调用。）

`server/index.ts`：import + `registerScenarioRoutes(app, ctx)` 一行（与其他 register 并列）。

- [ ] **Step 5: 跑测试确认通过 + dashboard 回归 + typecheck**

Run: `PATH=...:$PATH npx vitest run packages/dashboard && PATH=...:$PATH pnpm -r typecheck`
Expected: 全绿（replay/events 等既有用例零回归）

- [ ] **Step 6: 提交**

```bash
git add packages/dashboard pnpm-lock.yaml
git commit -m "feat(dashboard): GET /api/scenarios + POST replay/scenario 串行锁矩阵（S3/S11/S12/E4/E6/E7/SP4/SP8）"
```

---

### Task 9: UI — Scenarios 页 + 路由 + 导航

**Files:**
- Create: `packages/dashboard/src/ui/pages/Scenarios.tsx`
- Modify: `packages/dashboard/src/ui/router.tsx`（PageId + ROUTES）
- Modify: `packages/dashboard/src/ui/App.tsx:22-26`（nav 链接）
- Test: `packages/dashboard/src/__tests__/scenarios-page.test.ts`（新）

**Interfaces:**
- Consumes: T8 的两个端点 + api-types；既有 `usePolling`/`postJson`/`ApiError`

- [ ] **Step 1: 写失败测试**

`packages/dashboard/src/__tests__/scenarios-page.test.ts`：

```ts
/**
 * /scenarios 页渲染（S3/S11）：禁用态 / 列表 / 步骤级结果表（renderToString）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('../ui/hooks', () => ({
  usePolling: vi.fn(),
  useEventSource: () => ({ connected: false }),
}))
const { usePolling } = await import('../ui/hooks')
const { ScenariosPage } = await import('../ui/pages/Scenarios')

beforeEach(() => {
  vi.mocked(usePolling).mockReset()
})

describe('ScenariosPage', () => {
  it('disabled → 诚实空态引导文案', () => {
    vi.mocked(usePolling).mockReturnValue({ data: { enabled: false, scenarios: [] }, error: null, refresh: () => {} } as never)
    const html = renderToString(<ScenariosPage />)
    expect(html).toContain('no scenarios configured')
  })

  it('列表 → 场景卡（id/name/route/stepCount）+ Replay 按钮', () => {
    vi.mocked(usePolling).mockReturnValue({
      data: { enabled: true, scenarios: [{ id: 's-ok', name: 'ok 场景', route: '/users/1', stepCount: 2, file: 'mk/scenarios/s.yml' }] },
      error: null,
      refresh: () => {},
    } as never)
    const html = renderToString(<ScenariosPage />)
    expect(html).toContain('s-ok')
    expect(html).toContain('Replay')
    expect(html).toContain('/users/1')
  })

  it('replay 结果 → 步骤表（stepId/type/ok/duration）', () => {
    // 结果渲染子组件（ScenarioResult）单独具名导出并以最小 props 直测
    const { ScenarioResult } = await import('../ui/pages/Scenarios')
    const html = renderToString(
      <ScenarioResult result={{ replayId: 'r1', scenarioId: 's-ok', ok: true, steps: [{ stepId: 's-ok-step-0', type: 'goto', ok: true, durationMs: 4 }], createdAt: 'x', trailWritten: true }} />,
    )
    expect(html).toContain('s-ok-step-0')
    expect(html).toContain('goto')
  })
})
```

（JSX in .ts → 按 v1 T6 先例转 `createElement`；mock 返回值形状按 usePolling 泛型实际调整——断言不改。）

- [ ] **Step 2: 跑测试确认失败 → Step 3: 实现**

`Scenarios.tsx` 结构（既有页面风格：usePolling + ApiError 分支 + section 卡片）：

- disabled → `<p className="empty">no scenarios configured — add a scenarios: include: section to nx-mk.config.yml.</p>`
- 列表 → 每场景卡：`{id}` 徽章 + name + route + `${stepCount} steps` + `[Replay]` 按钮（`postJson<ScenarioReplayResponse>('/api/runs/local/replay/scenario/' + encodeURIComponent(id), {})`——**runId 裁定**：回放不依赖具体 run 数据，用字面 `local`（服务端 404 门要求 runs 下存在该 id——**T8 实现侧同步裁定：POST 的 run 门只校验 runs 目录存在性，字面 `local` 会 404！改为：POST run 门维持 unknown run 404，UI 用 `usePolling('/api/runs')` 取最新 runId 回填**——实现者以 /api/runs 响应实际形状取 runs[0].runId，空 runs → Replay 按钮 disabled + title 提示"run once first"）
- 结果 → `export function ScenarioResult({ result }: { result: ScenarioReplayResponse })`：`ok` 徽章 + 步骤表（stepId/type/ok/durationMs/error）+ trailWritten 提示
- replay 中按钮 disabled + 'Replaying…'

`router.tsx`：PageId union 加 `'scenarios'`；ROUTES 加 `{ pattern: '/scenarios', page: 'scenarios' }`（保持既有 pattern 风格）。`App.tsx` nav（22-26 行）加 `<a href="#/scenarios">Scenarios</a>`（以现有链接元素形状为准）。

- [ ] **Step 4: 跑测试确认通过 + UI 全回归**

Run: `PATH=...:$PATH npx vitest run packages/dashboard`
Expected: 新 3 用例 + 既有全绿（mock 工厂缺导出则按 T6/V6 先例补一行）

- [ ] **Step 5: 提交**

```bash
git add packages/dashboard/src
git commit -m "feat(dashboard-ui): /scenarios 页 —— 场景列表 + Replay + 步骤级结果表（S3/S11）"
```

---

### Task 10: 收尾 — 全仓验证 + 铁律 grep + spec §6 回写

**Files:**
- Modify: `docs/superpowers/specs/2026-09-21-nx-mk-scenario-dsl-replay-design.md`（§5 后追加 §6 实现裁定记录）

- [ ] **Step 1: 全套 + typecheck**

Run: `PATH=...:$PATH npx vitest run && PATH=...:$PATH pnpm -r typecheck`
Expected: 全绿；计数 588 + 约 50（预算带内）

- [ ] **Step 2: 铁律 grep**

Run: `grep -rn "writeFileSync\|renameSync\|appendFileSync\|createWriteStream" packages/dashboard/src/server/ --include="*.ts" | grep -v __tests__ | cut -d: -f1 | sort -u`
Expected: 恰 `packages/dashboard/src/server/replay.ts` 一文件

- [ ] **Step 3: spec §6 回写**（含 SP1-SP9 终局裁定 + demo 手动验收物料）：

追加小节内容必须含：(a) SP1（glob 自实现，修订 spec §2.2"复用 coverage matchGlob"——点段语义不适用）；(b) SP2-SP9 逐条；(c) T6 的 `SuiteObservers.afterStep` 第三参 page 透传接口演进；(d) 终态测试计数；(e) **demo 物料**（SP9）：

```yaml
# examples/react-vite-demo 侧（用户手动）mk/scenarios/user-profile.yml
version: 1
scenarios:
  - id: user-profile-basic
    name: 用户详情页基础覆盖
    route: /users/1
    steps:
      - id: open-user-profile
        type: goto
        url: http://localhost:5173/users/1
      - id: wait-profile
        type: waitFor
        selector: "[data-page='user-profile']"
      - id: assert-user-name
        type: assertFieldVisible
        field: user.profile.name
      - id: assert-user-email
        type: assertFieldVisible
        field: user.profile.email
      - id: shot
        type: screenshot
```

及 config 片段 `scenarios: {include: ["mk/scenarios/**/*.yml"], concurrency: 3}`、验收动作序列（run → /scenarios → Replay → trail 落盘核对）。

- [ ] **Step 4: 提交**

```bash
git add docs/superpowers/specs/2026-09-21-nx-mk-scenario-dsl-replay-design.md
git commit -m "docs(spec): §26 场景 DSL 实现裁定记录（SP1-SP9 + 接口演进 + demo 物料）"
```

---

## 验收对照（spec §5）

| spec 验收项 | 覆盖任务 |
|---|---|
| 1. vitest 全绿（588 → ~640±10）+ typecheck 零回归 | T10 Step 1 |
| 2. demo 手动验收（场景 → run 归因 trace → /scenarios → Replay → trail） | T1-T9 链路；物料与动作序列见 T10 Step 3(e) |
| 3. 铁律 grep（dashboard server 恰 replay.ts 1 写文件者） | T10 Step 2 |
| 4. 向后兼容（无 scenarios 段 = legacy collect；旧 run 两列 NULL 不破查询） | T5 降级用例 + 既有全绿即证 |
| 5. D2 零新增外部依赖（yaml/playwright-core lockfile 既有；dashboard 仅加 workspace 依赖） | T1/T8 的 package.json diff 审查 |
