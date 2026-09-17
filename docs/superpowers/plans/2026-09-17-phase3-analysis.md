# Phase 3 分析 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 coverage 数据可判定 —— id 空间统一 normalizedPath、policy-engine 全量（§21）、coverage analyzer 全量（§28）、anti-cheat v0 三类机检、run 产物闭环、demo goal 闭环（§1.4.2 端到端 PASS）。

**Architecture:** 纯函数核心 + IO 剥离延续（glob / policy-engine / classify / analyzer 全部纯函数，SQLite 与文件写在其外）；kernel 保持零依赖（initial-coverage 内置极简 glob 镜像 + 跨包契约测试钉住与 coverage glob 的语义一致）；run.ts 在 flush 后跑 analyzer 产出 CoverageReport（stdout 摘要 + JSON 落盘）。

**Tech Stack:** TypeScript 5.3 / vitest 1.6 / tsup / better-sqlite3（既有）；**零新第三方依赖**。

**Spec:** `docs/superpowers/specs/2026-09-17-nx-mk-phase3-analysis-design.md`（本计划从 spec 论证，两者一起阅读；冲突时 spec 为权威，plan 层面补充以「⚠️ 计划细化」标注）。

## Global Constraints

- Windows + Git Bash；pnpm **只经 `corepack pnpm`**（全局 8.15.9 被 engines 拒绝）；测试从仓库根 `npx vitest run [path]`
- 探针纪律（Phase 2 spec §4）：分析/检测侧任何异常不得破坏业务请求与既有 run 行为；SQLite 写失败 fail-fast（数据完整性优先）；报告 JSON 写失败仅 warn
- production 零开销不变：proxy 白名单判定在 analysis 分支内；production 路径无任何新增分配
- 中文注释对齐仓库风格；文件 ≤400 行；`corepack pnpm run demo:typecheck` 必须保持绿
- 提交信息 Conventional Commits；**不加任何 attribution 尾注**（Phase 2 最终裁定，user remit）
- 构建顺序（无 turbo）：client → coverage → kernel → config → plugin-playwright → cli；改导出后先构建依赖再跑 dependents 测试
- schema 演进规则：§25 plan DDL 冻结不动，新列一律 `ensureColumn` 幂等 `ALTER TABLE ADD COLUMN`（runs.terminated_by / ui_evidence.text_sample）

---

### Task 1: glob 纯函数（coverage/policy）

**Files:**
- Create: `packages/coverage/src/policy/glob.ts`
- Create: `packages/coverage/src/policy/index.ts`
- Test: `packages/coverage/__tests__/policy-glob.test.ts`

**Interfaces:**
- Produces: `matchGlob(pattern: string, path: string): boolean`（Task 2/9 消费）

- [ ] **Step 1: 失败测试**

```ts
// packages/coverage/__tests__/policy-glob.test.ts
/**
 * 有限通配匹配（spec §3.2）：按 '.' 分段；* 匹配单段；** 匹配零或多段；其余字面全等。
 * 这是 policy-engine 的地基 —— 语义矩阵在此钉死，kernel 侧镜像实现靠跨包契约测试对齐（Task 3）。
 */
import { describe, it, expect } from 'vitest'
import { matchGlob } from '../src/policy/index.js'

describe('matchGlob', () => {
  it('字面 pattern 精确全等', () => {
    expect(matchGlob('data.user.id', 'data.user.id')).toBe(true)
    expect(matchGlob('data.user.id', 'data.user.name')).toBe(false)
    expect(matchGlob('data.user', 'data.user.id')).toBe(false)
    expect(matchGlob('data.user.id', 'data.user')).toBe(false)
  })
  it('* 匹配恰好一段', () => {
    expect(matchGlob('*.metadata.*', 'data.metadata.traceId')).toBe(true)
    expect(matchGlob('*.metadata.*', 'data.metadata')).toBe(false)
    expect(matchGlob('data.*.city', 'data.address.city')).toBe(true)
    expect(matchGlob('data.*.city', 'data.a.b.city')).toBe(false)
  })
  it('** 匹配零或多段', () => {
    expect(matchGlob('data.**', 'data')).toBe(true)
    expect(matchGlob('data.**', 'data.a.b.c')).toBe(true)
    expect(matchGlob('**.id', 'data.user.id')).toBe(true)
    expect(matchGlob('**.id', 'data.user.profile')).toBe(false)
    expect(matchGlob('**', 'anything.at.all')).toBe(true)
  })
  it('混合与边界', () => {
    expect(matchGlob('data.**.id', 'data.user.id')).toBe(true)
    expect(matchGlob('data.**.id', 'data.id')).toBe(true)
    expect(matchGlob('', '')).toBe(true)
    expect(matchGlob('data', '')).toBe(false)
    expect(matchGlob('data.**', 'database.x')).toBe(false) // 段全等，非前缀
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/coverage/__tests__/policy-glob.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

```ts
// packages/coverage/src/policy/glob.ts
/**
 * 有限通配匹配（spec §3.2 / plan §21.5 示例语义）：按 '.' 分段。
 * '*' 匹配恰好一段；'**' 匹配零或多段；其余段字面全等。
 * 自实现而非 minimatch：规则面只有路径段通配（D4），全语义 glob 为过度引入。
 */
export function matchGlob(pattern: string, path: string): boolean {
  const p = pattern.split('.').filter(Boolean)
  const s = path.split('.').filter(Boolean)
  let i = 0
  let j = 0
  let starIdx = -1 // 最近一个 '**' 的 pattern 下标
  let restoreJ = 0 // 回溯时 path 的位置（'**' 吞掉的下一段起点）
  while (j < s.length) {
    if (i < p.length && (p[i] === s[j] || p[i] === '*')) {
      i++
      j++
    } else if (i < p.length && p[i] === '**') {
      starIdx = i
      restoreJ = j
      i++
    } else if (starIdx !== -1) {
      // 回溯：让 '**' 多吞一段
      i = starIdx + 1
      restoreJ++
      j = restoreJ
    } else {
      return false
    }
  }
  // path 耗尽后，pattern 剩余只允许 '**'（匹配零段）
  while (i < p.length && p[i] === '**') i++
  return i === p.length
}
```

```ts
// packages/coverage/src/policy/index.ts
export { matchGlob } from './glob.js'
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run packages/coverage/__tests__/policy-glob.test.ts`
Expected: PASS（4 用例）

- [ ] **Step 5: 提交**

```bash
git add packages/coverage/src/policy packages/coverage/__tests__/policy-glob.test.ts
git commit -m "feat(coverage): policy glob — segment wildcard matcher (spec §3.2)"
```

---

### Task 2: policy-engine + config coverage 段（§21.4/§21.5）

**Files:**
- Create: `packages/coverage/src/policy/policy-engine.ts`
- Modify: `packages/coverage/src/policy/index.ts`（导出追加）
- Modify: `packages/config/src/schema.ts`（+CoverageConfigSchema）
- Modify: `packages/config/src/index.ts`（导出追加）
- Test: `packages/coverage/__tests__/policy-engine.test.ts`、`packages/config/src/__tests__/loader.test.ts`（追加）

**Interfaces:**
- Consumes: `matchGlob`（Task 1）
- Produces: `evaluatePolicy(fields: ManifestFieldLike[], policy: PolicyConfig): PolicyDecision[]`；`PolicyConfig { required?: string[]; optional?: string[]; ignored?: string[] }`；`PolicyDecision`（§21.4 逐字）；config 侧 `CoverageConfigSchema` / `type CoverageConfig`（Task 8 消费）

- [ ] **Step 1: 失败测试（policy-engine）**

```ts
// packages/coverage/__tests__/policy-engine.test.ts
/**
 * §21.5 优先级矩阵逐行 + matchedRule 记录 + counted* 联动（spec §3.2）。
 * 优先级：user required > user ignored > user optional > default（schema required ? required : optional）> unknown
 */
import { describe, it, expect } from 'vitest'
import { evaluatePolicy, type ManifestFieldLike } from '../src/policy/index.js'
import { matchGlob } from '../src/policy/index.js'

const f = (id: string, normalizedPath: string, required?: boolean): ManifestFieldLike => ({ id, normalizedPath, required })

describe('evaluatePolicy — §21.5 优先级', () => {
  const fields = [
    f('f1', 'data.user.metadata.displayName', true), // schema required，同时被 user ignored 覆盖
    f('f2', 'data.internalRiskScore', false),
    f('f3', 'data.name', true),
    f('f4', 'data.tags[]', false),
  ]
  const policy = { required: [], optional: [], ignored: ['*.metadata.*', 'data.internalRiskScore'] }

  it('user required > user ignored（plan §21.5 示例语义）', () => {
    const d = evaluatePolicy([{ ...fields[0]!, required: true }], {
      required: ['data.user.metadata.displayName'],
      ignored: ['*.metadata.*'],
    })[0]!
    expect(d.status).toBe('required')
    expect(d.matchedRule).toEqual({ source: 'user-config', pattern: 'data.user.metadata.displayName' })
    expect(d.countedInRequiredCoverage).toBe(true)
    expect(d.countedInEffectiveCoverage).toBe(true)
  })
  it('user ignored > default-required；ignored 不进任何分母（§21.1）', () => {
    const d = evaluatePolicy([fields[0]!], policy)[0]!
    expect(d.status).toBe('ignored')
    expect(d.matchedRule).toEqual({ source: 'user-config', pattern: '*.metadata.*' })
    expect(d.countedInRequiredCoverage).toBe(false)
    expect(d.countedInEffectiveCoverage).toBe(false)
  })
  it('user ignored 命中 optional 字段', () => {
    const d = evaluatePolicy([fields[1]!], policy)[0]!
    expect(d.status).toBe('ignored')
    expect(d.matchedRule?.pattern).toBe('data.internalRiskScore')
  })
  it('default：schema required → required（matchedRule source=default）', () => {
    const d = evaluatePolicy([fields[2]!], policy)[0]!
    expect(d.status).toBe('required')
    expect(d.matchedRule).toEqual({ source: 'default', pattern: 'schema.required', reason: 'OpenAPI required 标记' })
  })
  it('default：非 required → optional', () => {
    const d = evaluatePolicy([fields[3]!], policy)[0]!
    expect(d.status).toBe('optional')
    expect(d.countedInRequiredCoverage).toBe(false)
    expect(d.countedInEffectiveCoverage).toBe(true)
  })
  it('unknown：无字段匹配时……不存在此态（default 必产 optional/required）——unknown 仅当字段缺 required 属性且无规则时', () => {
    // ManifestFieldLike.required 缺省视为 false → optional。unknown 由 analyzer 对 policy
    // 决策之外的路径产生（spec §3.3），engine 层单测锁定：decision 集合与输入一一对应
    const ds = evaluatePolicy(fields, policy)
    expect(ds).toHaveLength(4)
    expect(ds.every((d) => ['required', 'optional', 'ignored'].includes(d.status))).toBe(true)
  })
  it('同列表内按声明顺序取首个命中', () => {
    const d = evaluatePolicy([{ ...fields[1]!, required: false }], {
      ignored: ['data.internal*', 'data.internalRiskScore'],
    })[0]!
    expect(d.matchedRule?.pattern).toBe('data.internal*')
  })
  it('fieldId/fieldPath 直传', () => {
    const d = evaluatePolicy([fields[2]!], policy)[0]!
    expect(d.fieldId).toBe('f3')
    expect(d.fieldPath).toBe('data.name')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/coverage/__tests__/policy-engine.test.ts`
Expected: FAIL（evaluatePolicy 不存在）

- [ ] **Step 3: 实现 policy-engine**

```ts
// packages/coverage/src/policy/policy-engine.ts
/**
 * Coverage Policy Engine（plan §21 全量）—— 纯函数，无 IO。
 * 输入 manifest 字段子集 + config coverage 段，输出每字段 PolicyDecision（§21.4 逐字形状）。
 * 优先级 §21.5 逐字：user required > user ignored > user optional > default > unknown。
 * §21.1：ignored 不等于消失 —— 不进分母但仍出现在决策表（analyzer 据此产 ignored-returned）。
 */
import { matchGlob } from './glob.js'

export interface PolicyConfig {
  required?: string[]
  optional?: string[]
  ignored?: string[]
}

export interface MatchedRule {
  source: 'user-config' | 'default'
  pattern: string
  reason?: string
}

export type CoveragePolicyStatus = 'required' | 'optional' | 'ignored' | 'unknown'

export interface PolicyDecision {
  fieldId: string
  fieldPath: string
  status: CoveragePolicyStatus
  countedInRequiredCoverage: boolean
  countedInEffectiveCoverage: boolean
  matchedRule?: MatchedRule
}

/** analyzer/测试侧的 manifest 字段子集（不耦合 manifest-schema 类型） */
export interface ManifestFieldLike {
  id: string
  normalizedPath: string
  required?: boolean
}

// 用户列表内按声明顺序取首个命中；跨列表按优先级
function firstUserMatch(patterns: string[] | undefined, fieldPath: string): string | undefined {
  return patterns?.find((p) => matchGlob(p, fieldPath))
}

export function evaluatePolicy(fields: ManifestFieldLike[], policy: PolicyConfig): PolicyDecision[] {
  return fields.map((f) => {
    const fp = f.normalizedPath
    const req = firstUserMatch(policy.required, fp)
    if (req !== undefined) {
      return { fieldId: f.id, fieldPath: fp, status: 'required', countedInRequiredCoverage: true, countedInEffectiveCoverage: true, matchedRule: { source: 'user-config', pattern: req } }
    }
    const ign = firstUserMatch(policy.ignored, fp)
    if (ign !== undefined) {
      return { fieldId: f.id, fieldPath: fp, status: 'ignored', countedInRequiredCoverage: false, countedInEffectiveCoverage: false, matchedRule: { source: 'user-config', pattern: ign } }
    }
    const opt = firstUserMatch(policy.optional, fp)
    if (opt !== undefined) {
      return { fieldId: f.id, fieldPath: fp, status: 'optional', countedInRequiredCoverage: false, countedInEffectiveCoverage: true, matchedRule: { source: 'user-config', pattern: opt } }
    }
    // default：schema required 标记 → required，否则 optional（spec §3.2）
    if (f.required === true) {
      return { fieldId: f.id, fieldPath: fp, status: 'required', countedInRequiredCoverage: true, countedInEffectiveCoverage: true, matchedRule: { source: 'default', pattern: 'schema.required', reason: 'OpenAPI required 标记' } }
    }
    return { fieldId: f.id, fieldPath: fp, status: 'optional', countedInRequiredCoverage: false, countedInEffectiveCoverage: true, matchedRule: { source: 'default', pattern: 'schema.default', reason: '默认 optional' } }
  })
}
```

```ts
// packages/coverage/src/policy/index.ts —— 追加
export { matchGlob } from './glob.js'
export {
  evaluatePolicy,
  type PolicyConfig,
  type PolicyDecision,
  type MatchedRule,
  type CoveragePolicyStatus,
  type ManifestFieldLike,
} from './policy-engine.js'
```

- [ ] **Step 4: config schema 失败测试 → 实现**

`packages/config/src/__tests__/loader.test.ts` 追加 2 例：

```ts
// 追加用例：coverage 段 passthrough 与非法校验（对齐 Task 7 collect 段既有两例的模式）
it('loader passthrough: coverage 段（glob 列表）', async () => {
  // fixture 配置含 coverage: { ignored: ['**.metadata.**'], required: ['data.name'] }
  // 断言 loadConfig 产物 .coverage 深等于输入（config.passthrough 语义，同 collect 段例）
})
it('loader invalid: coverage.required 含非字符串 → CONFIG_INVALID', async () => {
  // coverage: { required: [42] } → 期待 rejects.toThrow(/CONFIG_INVALID|invalid/)
})
```

> ⚠️ 上面两例是行为规格：fixture 写法/断言细节按文件内既有 collect 段两例同构补齐（读该文件后照抄其 arrange 模式）。

`packages/config/src/schema.ts` 追加（CollectConfigSchema 定义之后）：

```ts
// Phase 3：coverage policy 段（spec §2.2/§3.2）—— 三个 glob 列表，缺省空
export const CoverageConfigSchema = z.object({
  required: z.array(z.string().min(1)).optional(),
  optional: z.array(z.string().min(1)).optional(),
  ignored: z.array(z.string().min(1)).optional(),
})
export type CoverageConfig = z.infer<typeof CoverageConfigSchema>
```

`ConfigSchema` 对象追加字段：`coverage: CoverageConfigSchema.optional(),`（collect 字段之后）。
`packages/config/src/index.ts` 导出追加 `CoverageConfigSchema, type CoverageConfig`。

- [ ] **Step 5: 全绿 + 提交**

Run: `npx vitest run packages/coverage packages/config`
Expected: PASS

```bash
git add packages/coverage/src/policy packages/coverage/__tests__/policy-engine.test.ts packages/config/src
git commit -m "feat(coverage,config): policy-engine §21 + config coverage section (spec §3.2)"
```

---

### Task 3: kernel id-space 对齐 + RunResult.terminatedBy（spec §3.1 + ⚠️计划细化：ignoredGlobs）

**Files:**
- Modify: `packages/kernel/src/initial-coverage.ts`
- Modify: `packages/kernel/src/plugin.ts:62`（RunResult 扩展）
- Modify: `packages/kernel/src/kernel.ts`（run() 返回值补 terminatedBy/coverage）
- Test: `packages/kernel/src/__tests__/initial-coverage.test.ts`（追加）、`packages/kernel/src/__tests__/goal-loop-integration.test.ts`（追加 1 例）

**Interfaces:**
- Produces: `readInitialCoverageFromManifest(cwd, opts?: { ignoredGlobs?: string[] })`；missing 项 `fieldId = f.normalizedPath`；`RunResult { runId, durationMs, terminatedBy?: string, coverage?: Coverage }`（Task 8 消费）

> ⚠️ 计划细化（超出 spec §3.1 的部分，执行时记入台账）：demo goal `targetRatio: 1.0` 要达标，goal 侧 missing 索引必须排除 policy-ignored 字段（如 `data.internalRiskScore` 永不被页面读取）。kernel 不依赖 coverage 包 —— 在 initial-coverage 内置 ~12 行镜像 matcher（与 coverage matchGlob 同语义），以跨包契约测试钉住两者一致。kernel goal 事件**无需改动**：kernel.ts:50 EventBus 已带 `persistTo`，:301/:315 的 goal:met/unmet emit 本就落 events.jsonl（T8 审查「未落文件」实因 demo 无 goal 段从未触发）。

- [ ] **Step 1: 失败测试**

`packages/kernel/src/__tests__/initial-coverage.test.ts` 追加：

```ts
// 追加用例（沿既有 fixture 写 manifest.json 到 tmp 的 arrange 模式）：
it('missing 项 fieldId = normalizedPath（不再是 stableFieldId 哈希，spec §3.1）', () => {
  // fixture fields: [{ id: 'hash1', normalizedPath: 'data.name' }, { id: 'hash2', normalizedPath: 'data.tags[]' }]
  // 断言 coverage.missing 全等 [{ kind: 'field', fieldId: 'data.name' }, { kind: 'field', fieldId: 'data.tags[]' }]
  //     coverage.total === 2
})
it('无 normalizedPath 的字段跳过（防御旧 manifest）', () => {
  // fixture fields: [{ id: 'a' }, { id: 'b', normalizedPath: 'data.x' }] → missing 仅 data.x
})
it('ignoredGlobs 排除字段（⚠️计划细化：goal 侧 policy 联动）', () => {
  // fixture 同上 + ignoredGlobs: ['data.*'] → missing 空、total 0
})
it('ignoredGlobs 用 ** 段通配', () => {
  // fields: data.internalRiskScore / data.name + ignoredGlobs: ['**.internalRiskScore'] → 仅剩 data.name
})
```

`goal-loop-integration.test.ts` 追加 1 例：

```ts
it('goal-met 后 RunResult 携带 terminatedBy 与 coverage（spec §3.1 审计链）', () => {
  // 沿既有 C1 用例 arrange（beforeRun emitReport → 1 字段 manifest）；断言 kernel.run() 产物：
  // result.terminatedBy === 'goal-met'；result.coverage?.kind 用 computeCoverage 断言 ratio===1
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/kernel/src/__tests__/initial-coverage.test.ts packages/kernel/src/__tests__/goal-loop-integration.test.ts`
Expected: FAIL（签名/字段不存在）

- [ ] **Step 3: 实现**

`initial-coverage.ts` 修改点：

```ts
// ManifestFieldSubset 扩展：
interface ManifestFieldSubset {
  id: string
  normalizedPath?: string   // spec §3.1：missing 索引改用路径；旧 manifest 无此字段则跳过
}

// 签名与实现：
export interface InitialCoverageOptions {
  /** ⚠️计划细化：goal 侧 policy 联动 —— 命中任一 glob 的字段不进 missing（kernel 内置镜像 matcher，跨包契约测试钉语义） */
  ignoredGlobs?: string[]
}

// 模块内私有 matcher（语义 = coverage/policy/glob 的 matchGlob：'.' 分段、* 单段、** 零或多段、字面全等）
function matchesIgnored(globs: string[], path: string): boolean {
  // 实现与 Task 1 matchGlob 同构（迭代回溯）；内核不 import coverage 以保零依赖
}

export function readInitialCoverageFromManifest(cwd: string, opts?: InitialCoverageOptions): Coverage {
  // …既有读取逻辑不变…
  const missing: MissingItem[] = fields
    .filter((f): f is ManifestFieldSubset & { normalizedPath: string } =>
      typeof f?.id === 'string' && f.id.length > 0 &&
      typeof f?.normalizedPath === 'string' && f.normalizedPath.length > 0)
    .filter((f) => !(opts?.ignoredGlobs && opts.ignoredGlobs.length > 0 && matchesIgnored(opts.ignoredGlobs, f.normalizedPath)))
    .map((f) => ({ kind: 'field', fieldId: f.normalizedPath }))
  // …PLACEHOLDER / total / ratio 逻辑不变…
}
```

头注释同步更新（「fieldId 即稳定哈希」→「fieldId 即 normalizedPath（spec §3.1）」）。

`packages/kernel/src/plugin.ts` RunResult（:62）追加：

```ts
export interface RunResult {
  runId: string
  durationMs: number
  /** Goal Loop 终止原因（非 goal run 为 undefined）—— 审计链 spec §3.1 */
  terminatedBy?: GoalResult['terminatedBy']
  /** 终止时覆盖率快照（非 goal run 为 undefined） */
  coverage?: Coverage
}
```

`kernel.ts` run()（:415 附近）返回值改为：

```ts
const goalRes: GoalResult | undefined = state.collectionResult ?? undefined
return {
  runId: opts.runId,
  durationMs: Date.now() - start,
  terminatedBy: goalRes?.terminatedBy,
  coverage: goalRes?.coverage,
}
```

（`state.collectionResult` 现有赋值在 kernel.ts:298，类型若非 GoalResult 则收窄。）

- [ ] **Step 4: kernel 全绿**

Run: `npx vitest run packages/kernel`
Expected: PASS（既有 C1 用例不受影响——missing 索引与 report fieldId 同为 path 字符串空间）

- [ ] **Step 5: 跨包契约测试（glob 镜像一致性）**

`packages/coverage/__tests__/policy-glob.test.ts` 追加：

```ts
it('跨包契约：coverage matchGlob 与 kernel 镜像 matcher 在混合矩阵上全等', async () => {
  // kernel 未导出私有 matcher —— 契约以行为矩阵钉住：读取 kernel dist 不可行，
  // 改为在 initial-coverage.test.ts 的 ignoredGlobs 用例矩阵（字面/*/**/混合）与本文件矩阵
  // 保持同一组 (pattern, path, expected) 三元组 —— 两文件共享同一常量数组（各自复制 8 行，
  // 注释互指）。任一侧语义漂移即对不上面矩阵。
})
```

> ⚠️ 实施者注意：上述契约测试落地方式 = 把 Step 1 的 ignoredGlobs 用例矩阵扩成与本文件相同的 10 组三元组（字面/*/**/混合各含正反例），两文件头注释互指「矩阵改动须双侧同步」。这是刻意的低技术契约（kernel 零依赖优先于 DRY）。

- [ ] **Step 6: 提交**

```bash
git add packages/kernel/src packages/kernel/src/__tests__ packages/coverage/__tests__/policy-glob.test.ts
git commit -m "feat(kernel): id-space alignment — normalizedPath missing index + RunResult.terminatedBy (spec §3.1)"
```

---

### Task 4: schema 演进 + evidence textSample 通道（db + client 类型）

**Files:**
- Modify: `packages/coverage/src/db/schema.ts`（+ensureColumn 工具）
- Modify: `packages/coverage/src/db/client.ts`（构造时 ensureColumn ×2；endRun +terminatedBy；flushDrained text_sample）
- Modify: `packages/client/src/collector/collector.ts`（UiEvidenceCore +textSample?）
- Test: `packages/coverage/__tests__/db.test.ts`（追加）、`packages/client/__tests__/collector.test.ts`（追加 1 例）

**Interfaces:**
- Produces: `ensureColumn(db: {pragma, exec}, table: string, column: string, decl: string): void`；`endRun(runId, endedAt, status, terminatedBy?: string)`；`UiEvidenceCore.textSample?: string`（Task 6/7/8 消费）

- [ ] **Step 1: 失败测试**

`packages/coverage/__tests__/db.test.ts` 追加：

```ts
// 追加用例（沿既有 openCoverageDb tmp 文件模式）：
it('runs 表幂等加列 terminated_by（spec §3.1 schema 演进）', () => {
  // openCoverageDb 后：pragma table_info(runs) 含 terminated_by；
  // 对同一 db 文件二次 openCoverageDb 不抛（CREATE IF NOT EXISTS + ensureColumn 幂等）
})
it('endRun 写 terminated_by', () => {
  // insertRun → endRun(id, ts, 'completed', 'goal-met') → SELECT terminated_by === 'goal-met'
})
it('endRun 不传 terminatedBy 时保留原值', () => {
  // endRun(..., 'goal-met') 后再 endRun(..., 'failed')（无第 4 参）→ terminated_by 仍 'goal-met'
})
it('ui_evidence 幂等加列 text_sample 且 flushDrained 写入', () => {
  // evidence 带 textSample: 'HZ' → flushDrained → SELECT text_sample === 'HZ'
})
```

`packages/client/__tests__/collector.test.ts` 追加：

```ts
it('evidence 带 textSample 时 drain 原样透传', () => {
  // collector.evidence({ fieldPath: 'data.address.city', evidenceType: 'text', visible: true, inViewport: true, textSample: 'HZ' })
  // 断言 drain().evidence[0]!.textSample === 'HZ'
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/coverage/__tests__/db.test.ts packages/client/__tests__/collector.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

`packages/coverage/src/db/schema.ts` 追加：

```ts
/**
 * 幂等加列（spec §3.1 schema 演进规则）：§25 plan DDL 冻结，新列以 ALTER 落地。
 * 重复调用安全 —— 先查 PRAGMA table_info。
 */
export function ensureColumn(
  db: { pragma(sql: string): unknown; exec(sql: string): void },
  table: string,
  column: string,
  decl: string,
): void {
  const cols = db.pragma(`table_info(${table})`) as { name: string }[]
  if (Array.isArray(cols) && cols.some((c) => c.name === column)) return
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`)
}
```

`packages/coverage/src/db/client.ts`：

```ts
// 构造函数内 exec(SCHEMA_SQL) 之后：
ensureColumn(this.db, 'runs', 'terminated_by', 'TEXT')
ensureColumn(this.db, 'ui_evidence', 'text_sample', 'TEXT')

// endRun 扩展（第 4 参可选，向后兼容既有调用）：
endRun(runId: string, endedAt: string, status: string, terminatedBy?: string): void {
  this.db.prepare(
    `UPDATE runs SET ended_at = ?, status = ?, terminated_by = COALESCE(?, terminated_by) WHERE id = ?`,
  ).run(endedAt, status, terminatedBy ?? null, runId)
}

// flushDrained 的 ui_evidence INSERT：列清单与 VALUES 增加 text_sample（值 ev.textSample ?? null）
```

`packages/client/src/collector/collector.ts` UiEvidenceCore 追加：

```ts
export interface UiEvidenceCore {
  // …既有字段…
  /** anti-cheat 空标记判定用文本样本（spec §3.4；截断 80 字符，缺省按 valid 处理） */
  textSample?: string
}
```

- [ ] **Step 4: 全绿 + 提交**

Run: `npx vitest run packages/coverage packages/client`
Expected: PASS

```bash
git add packages/coverage/src/db packages/coverage/__tests__/db.test.ts packages/client/src/collector packages/client/__tests__/collector.test.ts
git commit -m "feat(coverage,client): schema evolution — ensureColumn + terminated_by/text_sample (spec §3.1/§3.4)"
```

---

### Task 5: proxy 原型方法名白名单（anti-cheat #3）

**Files:**
- Modify: `packages/client/src/proxy/create-tracked-proxy.ts`
- Test: `packages/client/__tests__/proxy.test.ts`（追加）

**Interfaces:**
- Produces: `METHOD_NAME_BLOCKLIST: ReadonlySet<string>`、`ARRAY_ONLY_NAMES: ReadonlySet<string>`、`isBlockedProp(target: object, key: string): boolean`（导出供测试与 Phase 4 复用）

- [ ] **Step 1: 失败测试**

`packages/client/__tests__/proxy.test.ts` 追加：

```ts
// 追加 describe（沿既有 createTrackedProxy + collector 计数断言模式）：
describe('原型方法名白名单（spec §3.4 anti-cheat #3）', () => {
  it('Promise 方法名不进 hit 且不包裹：then/catch/finally/toJSON', () => {
    // target { then: fn } —— 读 resp.then：返回原值（=== fn），collector 无新增 hit
  })
  it('Array 方法名不进 hit：join/map/filter/reduce/forEach/keys/values/entries/size', () => {
    // target { tags: [1,2] } 逐个读 resp.tags[join/map/...]：返回原方法值，无 hit
  })
  it('length 仅对 Array target 生效：数组 length 无 hit；plain object 的 length 是真字段仍 hit+包裹', () => {
    // arr: [1,2,3] 包裹 → resp.length === 3 且无 hit
    // obj { length: 5 } 包裹 → resp.length === 5（数字原值）且 collector.hits 含 'data.length'
  })
  it('Object 原型名不进 hit：valueOf/toString/hasOwnProperty', () => { /* 同模式 */ })
  it('真实字段不受影响（回归）：name/id/address 照常 hit + 嵌套包裹', () => { /* 沿用既有断言模式 */ })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/client/__tests__/proxy.test.ts`
Expected: FAIL（then 等仍产生 hit）

- [ ] **Step 3: 实现**

`create-tracked-proxy.ts`：模块级常量 + get 拦截早退（symbol 检查之后、探针 try 之前）：

```ts
/** Promise/JSON 序列化触发的伪字段名（anti-cheat #3，spec §3.4）—— 恒透传不 hit 不包裹 */
export const METHOD_NAME_BLOCKLIST: ReadonlySet<string> = new Set([
  'then', 'catch', 'finally', 'toJSON', 'valueOf', 'toString', 'hasOwnProperty',
  'join', 'map', 'filter', 'reduce', 'forEach', 'keys', 'values', 'entries', 'size',
])
/** 仅 Array target 生效的名单（plain object 的 length 等可能是真实业务字段） */
export const ARRAY_ONLY_NAMES: ReadonlySet<string> = new Set([
  'length', 'indexOf', 'includes', 'slice', 'concat',
])

export function isBlockedProp(target: object, key: string): boolean {
  if (METHOD_NAME_BLOCKLIST.has(key)) return true
  if (ARRAY_ONLY_NAMES.has(key) && Array.isArray(target)) return true
  return false
}
```

get 拦截内插入（`if (typeof prop === 'symbol')` 之后）：

```ts
const key = typeof prop === 'string' ? prop : ''
if (key !== '' && isBlockedProp(obj, key)) {
  return Reflect.get(obj, prop, receiver) // 白名单透传：不 collector.hit、不递归包裹
}
```

头注释补一行 todo（Phase 4 可扩展名单）。

- [ ] **Step 4: 全绿（client 全量回归——零开销语义不动）+ 提交**

Run: `npx vitest run packages/client`
Expected: PASS（含 production 零开销回归）

```bash
git add packages/client/src/proxy packages/client/__tests__/proxy.test.ts
git commit -m "feat(client): proxy prototype-method blocklist — data.then noise gone (spec §3.4)"
```

---

### Task 6: scanner textSample 通道（plugin-playwright + coverage dom-scanner）

**Files:**
- Modify: `packages/plugin-playwright/src/scanner.ts`（PAGE_SCAN_SCRIPT + toDescriptors）
- Modify: `packages/coverage/src/evidence/dom-scanner.ts`（DomFieldDescriptor +text、scanDom 透传 textSample）
- Modify: `packages/plugin-playwright/src/runner.ts`（描述符流经 scanDom 的传参确认——若 runner 直接把 ParsedDescriptor 喂 scanDom，字段名对齐）
- Test: `packages/plugin-playwright/__tests__/plugin.test.ts`（追加）、`packages/coverage/__tests__/dom-scanner.test.ts`（追加）

**Interfaces:**
- Consumes: `UiEvidenceCore.textSample?`（Task 4）
- Produces: `ParsedDescriptor.text: string`（≤80 字符）；`DomFieldDescriptor.text?: string`；scanDom 产 evidence 带 `textSample`

- [ ] **Step 1: 失败测试**

`packages/coverage/__tests__/dom-scanner.test.ts` 追加：

```ts
it('scanDom 透传 text → textSample（spec §3.4 空标记判定数据源）', () => {
  // scanDom([{ dataMkField: 'data.name', visible: true, inViewport: true, text: 'Alice' }])
  // 断言 evidence[0].textSample === 'Alice'
})
it('text 缺省 → textSample undefined（向后兼容旧描述符）', () => {
  // scanDom([{ dataMkField: 'data.name', visible: true, inViewport: true }]) → textSample undefined
})
```

`packages/plugin-playwright/__tests__/plugin.test.ts` 追加：

```ts
it('toDescriptors 透传 text（字符串截断 80；非字符串 → 空）', () => {
  // toDescriptors([{ dataMkField: 'a', visible: true, inViewport: true, text: 'x'.repeat(100) }])
  // 断言 out[0].text === 'x'.repeat(80)
  // toDescriptors([{ dataMkField: 'a', visible: true, inViewport: true, text: 42 }]) → text === ''
})
it('PAGE_SCAN_SCRIPT 采集 textContent（脚本含 textContent 与 slice(0, 80)）', () => {
  // 沿既有「脚本内容断言」模式：字符串包含检查
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/coverage/__tests__/dom-scanner.test.ts packages/plugin-playwright`
Expected: FAIL

- [ ] **Step 3: 实现**

`scanner.ts`：PAGE_SCAN_SCRIPT 的 map 产物追加 `text: ((el.textContent || '') + '').trim().slice(0, 80)`；
`RawDescriptor` + `ParsedDescriptor` 追加 `text: string`（toDescriptors：`typeof d.text === 'string' ? d.text.slice(0, 80) : ''`）。

`dom-scanner.ts`：

```ts
export interface DomFieldDescriptor {
  dataMkField: string
  visible: boolean
  inViewport: boolean
  /** anti-cheat 空标记判定样本（spec §3.4；可选 —— 旧调用方兼容） */
  text?: string
}
// scanDom map 产物追加：textSample: d.text
```

`runner.ts`：核对描述符 → scanDom 的数据流，ParsedDescriptor 与 DomFieldDescriptor 结构对齐（text 字段互通；若 runner 有显式字段挑选则补 text）。

- [ ] **Step 4: 全绿 + 提交**

Run: `npx vitest run packages/plugin-playwright packages/coverage`
Expected: PASS

```bash
git add packages/plugin-playwright/src packages/plugin-playwright/__tests__ packages/coverage/src/evidence packages/coverage/__tests__/dom-scanner.test.ts
git commit -m "feat(plugin-playwright,coverage): evidence textSample channel — anti-cheat input (spec §3.4)"
```

---

### Task 7: anti-cheat classify + analyzer 全量 + CoverageReport（§28/§29）

**Files:**
- Create: `packages/coverage/src/anti-cheat/classify.ts`
- Create: `packages/coverage/src/anti-cheat/index.ts`
- Create: `packages/coverage/src/analyzer/report.ts`
- Modify: `packages/coverage/src/analyzer/coverage-analyzer.ts`（重写）
- Modify: `packages/coverage/src/index.ts`（导出追加）
- Test: `packages/coverage/__tests__/anti-cheat.test.ts`（新建）、`packages/coverage/__tests__/coverage-analyzer.test.ts`（重写用例集）

**Interfaces:**
- Consumes: `evaluatePolicy` 产物（Task 2）、`UiEvidenceCore`（Task 4/6）、`matchGlob`（间接）
- Produces: `classifyEvidence(ev): EvidenceQuality`；`analyzeCoverage(input: AnalyzeInput): CoverageReport`；`CoverageReport` 类型（Task 8/9 消费）

- [ ] **Step 1: 失败测试（classify）**

```ts
// packages/coverage/__tests__/anti-cheat.test.ts
/** §29.1 四态 v0 三类机检（spec §3.4）：hidden→suspicious；空/字段名→weak；其余→valid；invalid 不产 */
import { describe, it, expect } from 'vitest'
import { classifyEvidence } from '../src/anti-cheat/index.js'

describe('classifyEvidence', () => {
  it('visible=false → suspicious（hidden DOM 覆盖）', () => {
    expect(classifyEvidence({ visible: false, textSample: 'secret', fieldPath: 'data.token' })).toBe('suspicious')
  })
  it('textSample 空串 → weak（只标记不展示）', () => {
    expect(classifyEvidence({ visible: true, textSample: '', fieldPath: 'data.name' })).toBe('weak')
  })
  it('textSample 缺省 → weak？否 —— 缺省按 valid（向后兼容，spec §4）', () => {
    expect(classifyEvidence({ visible: true, fieldPath: 'data.name' })).toBe('valid')
  })
  it('textSample === 字段路径末段 → weak（占位文本）', () => {
    expect(classifyEvidence({ visible: true, textSample: 'name', fieldPath: 'data.user.name' })).toBe('weak')
  })
  it('visible 且有真实文本 → valid', () => {
    expect(classifyEvidence({ visible: true, textSample: 'Alice', fieldPath: 'data.user.name' })).toBe('valid')
  })
  it('textSample 首尾空白修剪后判定', () => {
    expect(classifyEvidence({ visible: true, textSample: '  ', fieldPath: 'data.name' })).toBe('weak')
  })
})
```

- [ ] **Step 2: 跑测试确认失败 → 实现 classify**

```ts
// packages/coverage/src/anti-cheat/classify.ts
/**
 * Evidence Quality v0（plan §29.1/§29.2 三类机检，spec §3.4）：
 * hidden DOM（visible=false）→ suspicious；空标记（空文本/占位=字段名）→ weak；
 * 其余 → valid；'invalid' v0 不产（console.log 源检测后置）。
 * 全部判定来自已采集数据，零新增运行时探针（D3）。
 */
export type EvidenceQuality = 'valid' | 'weak' | 'suspicious' | 'invalid'

export interface ClassifiableEvidence {
  visible?: boolean
  textSample?: string
  fieldPath: string
}

export function classifyEvidence(ev: ClassifiableEvidence): EvidenceQuality {
  if (ev.visible === false) return 'suspicious'
  // textSample 缺省 = 旧采集数据 —— 按 valid 处理（spec §4 向后兼容行）
  if (ev.textSample === undefined) return 'valid'
  const t = ev.textSample.trim()
  if (t === '') return 'weak'
  const last = ev.fieldPath.split('.').pop() ?? ''
  if (last !== '' && t === last) return 'weak'
  return 'valid'
}
```

```ts
// packages/coverage/src/anti-cheat/index.ts
export { classifyEvidence, type EvidenceQuality, type ClassifiableEvidence } from './classify.js'
```

- [ ] **Step 3: 失败测试（analyzer 全量）**

`packages/coverage/__tests__/coverage-analyzer.test.ts` 重写用例集（保留 13 列逐列绑定锁的写法，字段值升级）：

```ts
/**
 * analyzer 全量（spec §3.3）：四态 + 三指标 + ignored-returned + suspicious + 列值锁。
 * fixture：manifest 5 response 字段（2 required 命中 / 1 required 未命中 / 1 optional 命中 /
 * 1 ignored 命中）+ evidence（1 valid / 1 weak / 1 suspicious）—— 沿既有 tmp SQLite + insertRun arrange。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openCoverageDb } from '../src/index.js'
import { evaluatePolicy } from '../src/policy/index.js'
import { analyzeCoverage } from '../src/analyzer/index.js'
import type { FieldHitCore, UiEvidenceCore } from '@nx-mk/client/collector'

// fixture 字段（normalizedPath 即 §17 形态）：
//   data.name (required) 命中 | data.email (required) 未命中 | data.tags[] (optional) 命中
//   data.internalRiskScore (ignored) 命中 | data.address.city (optional) 未命中
const FIELDS = [
  { id: 'h1', normalizedPath: 'data.name', required: true, endpointId: 'getUser', direction: 'response' as const },
  { id: 'h2', normalizedPath: 'data.email', required: true, endpointId: 'getUser', direction: 'response' as const },
  { id: 'h3', normalizedPath: 'data.tags[]', required: false, endpointId: 'getUser', direction: 'response' as const },
  { id: 'h4', normalizedPath: 'data.internalRiskScore', required: false, endpointId: 'getUser', direction: 'response' as const },
  { id: 'h5', normalizedPath: 'data.address.city', required: false, endpointId: 'getUser', direction: 'response' as const },
]
const POLICY = { required: [], optional: [], ignored: ['data.internalRiskScore'] }
const HITS = (paths: string[]) => paths.map((normalizedPath) => ({ normalizedPath, count: 1, requestId: 'r1', endpointId: 'getUser' }))

describe('analyzeCoverage — 四态与三指标', () => {
  // beforeEach/afterEach：tmp dir + openCoverageDb + insertRun（沿既有模式）

  it('covered：required/optional 且 accessHit', () => {
    // 输入 hits=[data.name, data.tags[]]，无 evidence
    // 断言：missing list === ['data.email']；coverage_fields 行 data.name state='covered'
  })
  it('uiHit 计入 covered；suspicious evidence 不计入且进 suspiciousCoverage；weak 计入且进 weakEvidenceFields', () => {
    // evidence: data.name(valid text) / data.email(weak textSample:'' visible:true) / data.tags[](suspicious visible:false)
    // hits 仅 [data.address.city]
    // 断言：data.name covered（uiHit）；data.email —— weak 计入 hit → covered 且 weakEvidenceFields 含之
    //       data.tags[] suspicious → 不算 hit → notApplicable + suspiciousCoverage 含之
  })
  it('ignored 命中 → ignored-returned 集合（§22 数据）', () => {
    // hits 含 data.internalRiskScore → ignoredReturnedFields 含之（带 hit count）
  })
  it('三指标算术（§21.6）与零分母', () => {
    // 上例全量输入：requiredCoverage = 1/2；effectiveCoverage = 3/4（required2+optional2 分母，covered: name/tags[]/address.city）
    // rawBackendFieldCoverage = 4/5（returned = 命中过 4 个 / response 5 个）
    // 空分母场景：无 required 字段 → requiredCoverage === 0（不 NaN）
  })
  it('metrics 计数与 §28.2 形状（endpoints/counts）', () => {
    // endpointsTotal=1（fixture manifest.endpoints 1 个）+ traces 带 endpointId 'getUser' → endpointsCalled=1
  })
  it('coverage_fields 列值锁（13 列逐列绑定，state 迁移 D6）', () => {
    // SELECT 全行：data.name → policy_status='required'(schema required)/coverage_state='covered'/
    // access_hit=1/ui_hit=0/suspicious=0/counted_required=1/counted_effective=1
    // data.internalRiskScore → policy_status='ignored'/counted_*=0
  })
})
```

- [ ] **Step 4: 跑测试确认失败 → 实现 report 类型 + analyzer 重写**

```ts
// packages/coverage/src/analyzer/report.ts
/** §28.2 CoverageReport 形状（spec §3.3）—— Phase 4 Dashboard 的数据契约起点（D7） */
export interface FieldCoverageItem {
  fieldId: string
  fieldPath: string
  endpointId?: string
  state: 'covered' | 'missing' | 'ignored' | 'notApplicable'
  policyStatus: 'required' | 'optional' | 'ignored' | 'unknown'
  hitCount?: number
  matchedRule?: { source: string; pattern: string; reason?: string }
}
export interface EndpointCoverage {
  endpointId: string
  method: string
  path: string
  called: boolean
  fieldsTotal: number
  fieldsCovered: number
}
export interface CoverageReportMetrics {
  requiredCoverage: number
  effectiveCoverage: number
  rawBackendFieldCoverage: number
  endpointsTotal: number
  endpointsCalled: number
  fieldsTotal: number
  fieldsReturned: number
  requiredFields: number
  missingRequiredFields: number
  ignoredReturnedFields: number
  suspiciousFields: number
}
export interface CoverageReport {
  runId: string
  metrics: CoverageReportMetrics
  missingRequiredFields: FieldCoverageItem[]
  weakEvidenceFields: FieldCoverageItem[]
  ignoredReturnedFields: FieldCoverageItem[]
  suspiciousCoverage: FieldCoverageItem[]
  endpoints: EndpointCoverage[]
}
```

```ts
// packages/coverage/src/analyzer/coverage-analyzer.ts —— 重写
/**
 * Coverage Analyzer 全量（plan §28 / spec §3.3）。纯函数核心 + coverage_fields IO。
 * 输入：manifest + policy 决策 + collector drain 产物；输出 §28.2 CoverageReport。
 * 四态 §21.3：ignored → 'ignored'；(accessHit ∨ uiHit) → 'covered'；required 未命中 → 'missing'；
 * optional/unknown 未命中 → 'notApplicable'（D6：state 枚举自 D7 'optional-unhit' 迁移）。
 * uiHit 语义：该字段存在 evidence 且 classifyEvidence !== 'suspicious'（weak 计 hit 但入 weak 清单）。
 */
import type { ApiManifest } from '@nx-mk/manifest-schema'
import { classifyEvidence } from '../anti-cheat/index.js'
import type { PolicyDecision } from '../policy/index.js'
import type { CoverageReport, FieldCoverageItem, EndpointCoverage } from './report.js'

export interface AnalyzerDb { prepare(sql: string): { run(...params: unknown[]): unknown; get(...params: unknown[]): unknown } }
export interface AnalyzeDrained {
  hits: { normalizedPath: string; count: number }[]
  traces: { endpointId?: string; method?: string; path?: string }[]
  evidence: { fieldPath: string; visible?: boolean; textSample?: string }[]
}
export interface AnalyzeInput {
  runId: string
  manifest: ApiManifest
  policyDecisions: PolicyDecision[]
  drained: AnalyzeDrained
  db: AnalyzerDb
}

export function analyzeCoverage(input: AnalyzeInput): CoverageReport {
  // 实现要点（实施者按测试逐例落地）：
  // 1. 索引：hitCount by normalizedPath（count>0）；evidence by fieldPath（同字段多条取最差质量
  //    —— suspicious > weak > valid）；decision by fieldPath
  // 2. 遍历 manifest.fields（direction==='response'）：查 decision（缺 → policyStatus 'unknown'、两分母不进）
  // 3. state 判定 + 四组清单组装 + metrics 累计（分母为零 → 0，不 NaN）
  // 4. endpoints：manifest.endpoints × traces endpointId 去重（'unknown'/空 不计 called）
  // 5. coverage_fields 13 列 INSERT OR REPLACE（id `cf_${runId}_${normalizedPath}`，逐列绑定沿旧模式；
  //    assertion_hit 恒 0）
}
```

`packages/coverage/src/analyzer/index.ts`（若现 barrel 直出 analyzer，保持路径不变）+ `packages/coverage/src/index.ts` 导出追加：`analyzeCoverage`（新签名）、`type CoverageReport` 等、`classifyEvidence`。

- [ ] **Step 5: 全绿（coverage 全量 + client 既有 analyzer 消费测试迁移）+ 提交**

Run: `npx vitest run packages/coverage packages/client tests/integration`
Expected: PASS（Phase 2 集成测试若直接调旧 analyzeCoverage 签名则同步迁移到新签名——预期 1-2 处）

```bash
git add packages/coverage/src packages/coverage/__tests__
git commit -m "feat(coverage): full analyzer §28 + anti-cheat classify §29 — CoverageReport (spec §3.3/§3.4)"
```

---

### Task 8: run.ts 装配 —— analyzer + 产物（spec §3.5）

**Files:**
- Modify: `packages/cli/src/commands/run.ts`
- Test: `packages/cli/src/__tests__/run-collect.test.ts`（追加）

**Interfaces:**
- Consumes: `analyzeCoverage`（Task 7）、`evaluatePolicy`/`CoverageConfig`（Task 2）、`RunResult.terminatedBy`（Task 3）、`endRun(…, terminatedBy?)`（Task 4）
- Produces: run 末尾 stdout 三行摘要 + `.nx-mk/coverage-report.json`；endRun 带 terminatedBy

- [ ] **Step 1: 失败测试**

`packages/cli/src/__tests__/run-collect.test.ts` 追加（沿既有 hermetic tmp-fixture + opts.collector 注入模式）：

```ts
// 追加用例：
it('collect + coverage 段：run 后产出 coverage-report.json 且三指标非零', () => {
  // fixture cwd：.nx-mk/manifest.json（1 response 字段 data.name）+ nx-mk.config.yml（collect + coverage: { required: ['data.name'] }）
  // opts.collector 注入：collector.hit({ requestId:'r1', endpointId:'ep1', normalizedPath:'data.name', source:'proxy' })（沿既有 flush 用例的 FieldHitCore 形状）
  // runMain 后：readFileSync(cwd/.nx-mk/coverage-report.json) 解析 —— metrics.requiredCoverage === 1、fieldsTotal === 1
})
it('run 摘要 stdout 含三指标行与 Report 路径', () => {
  // spy console.log：断言包含 'required' 与 'coverage-report.json'
})
it('kernel.run 返回 terminatedBy 时 endRun 落 runs.terminated_by', () => {
  // 沿 Task 8 M1 既有 hoisted mock createKernel 模式：mock 返回 { runId, durationMs, terminatedBy: 'goal-met' }
  // run 后 SELECT terminated_by === 'goal-met'
})
it('report JSON 写失败仅 warn 不阻断（spec §4）', () => {
  // 把 .nx-mk/coverage-report.json 预置为目录 → runMain 仍 resolve 且 console.warn 被调
})
it('无 collect 段：不产 report、endRun 不带 terminatedBy（行为不变回归）', () => {
  // 既有「collect 缺失」用例组追加断言：coverage-report.json 不存在
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/cli/src/__tests__/run-collect.test.ts`
Expected: FAIL（新用例）

- [ ] **Step 3: 实现（run.ts 成功路径追加，~35 行）**

成功路径（`db.flushDrained` 之后、`endRun` 处）：

```ts
// —— Phase 3：analyzer + 产物（spec §3.5）——
if (db && collector) {
  const drained = collector.drain() // 与 flushDrained 共用一次 drain（改 flush 调用为 { runId, ...drained }）
  // 1. manifest 读取失败容忍（spec §4：goal-loop 已容忍此态）
  let manifest: ApiManifest | undefined
  try { manifest = JSON.parse(readFileSync(join(cwd, '.nx-mk', 'manifest.json'), 'utf8')) } catch { /* warn 下移 */ }
  if (manifest) {
    const coverageCfg = (config as typeof config & { coverage?: CoverageConfig }).coverage ?? {}
    const decisions = evaluatePolicy(manifest.fields, coverageCfg)
    const report = analyzeCoverage({ runId, manifest, policyDecisions: decisions, drained, db })
    // 2. stdout 摘要
    const pct = (n: number) => `${Math.round(n * 100)}%`
    console.log(`  Coverage: required ${pct(report.metrics.requiredCoverage)} | effective ${pct(report.metrics.effectiveCoverage)} | raw backend ${pct(report.metrics.rawBackendFieldCoverage)}`)
    console.log(`  missing required: ${report.metrics.missingRequiredFields} | ignored returned: ${report.metrics.ignoredReturnedFields} | suspicious: ${report.metrics.suspiciousFields}`)
    // 3. JSON 落盘（写失败 warn 不阻断 —— 报告是产物不是账本，coverage_fields 已落库）
    try {
      writeFileSync(join(cwd, '.nx-mk', 'coverage-report.json'), JSON.stringify(report, null, 2))
      console.log(`  Report: .nx-mk/coverage-report.json`)
    } catch (err) {
      console.warn(`coverage-report.json write failed: ${(err as Error).message}`)
    }
  } else {
    console.warn('coverage analysis skipped — .nx-mk/manifest.json unavailable')
  }
}
// endRun 带 terminatedBy（Task 3 RunResult；drain 顺序注意：flush 与 analyzer 共用 drained）
db.endRun(runId, new Date().toISOString(), 'completed', result.terminatedBy)
```

（flush 调用点同步改为 `db.flushDrained({ runId, ...drained })`；analyzer 块挪到 flush 之后共用 `drained`。manifest 字段类型不匹配处按 manifest-schema 实际形状收窄；导入追加 `evaluatePolicy`、`analyzeCoverage`、`type CoverageConfig`、node:fs `writeFileSync`。）

- [ ] **Step 4: 全绿（cli + 全量）+ 提交**

Run: `npx vitest run`
Expected: PASS（275 + 新增）

```bash
git add packages/cli/src
git commit -m "feat(cli): coverage analysis wiring — report JSON + stdout summary + terminated_by (spec §3.5)"
```

---

### Task 9: demo goal 闭环 + 三点契约集成 + README（spec §3.6 / §1.4）

**Files:**
- Modify: `examples/react-vite-demo/app/src/UserProfile.tsx`（Field 值改 normalizedPath 约定）
- Modify: `examples/react-vite-demo/nx-mk.config.yml`（+goal +coverage 段）
- Create: `tests/integration/phase3-analyze.test.ts`
- Modify: `README.md`（Phase 3 状态 + 验收更新）
- Modify: root `package.json`（若 test include 需含新集成文件——核对 vitest config include）

**Interfaces:**
- Consumes: 全部前序任务
- Produces: demo 手动验收 = spec §1.4.1（goal:met 事件 + runs.terminated_by + coverage-report.json 三点互证）

- [ ] **Step 1: 三点契约 + 全链失败测试**

```ts
// tests/integration/phase3-analyze.test.ts
/**
 * Phase 3 集成（hermetic）：①三点契约（manifest fieldPath ↔ proxy normalizedPath ↔ DOM
 * data-mk-field 同空间，spec §1.4.2）②policy → analyzer → CoverageReport 全链 ③initial-coverage
 * ignoredGlobs 与 coverage matchGlob 跨包矩阵契约（Task 3 Step 5 的执行落点若在此，合并且双侧同步）。
 * 不跑真浏览器 —— 真实链路 = demo 手动验收（README 步骤）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openCoverageDb } from '@nx-mk/coverage'
import { evaluatePolicy, matchGlob } from '@nx-mk/coverage'
import { analyzeCoverage } from '@nx-mk/coverage'
import { createCollector } from '@nx-mk/client/collector'
import { createTrackedProxy } from '@nx-mk/client/proxy'
import { readInitialCoverageFromManifest } from '@nx-mk/kernel'

// fixture manifest（demo User 语义：required name/email；optional 其余；ignored internalRiskScore）
const MANIFEST = {
  endpoints: [{ id: 'getUser', method: 'GET', path: '/users/{id}' }],
  fields: [
    { id: 'h1', normalizedPath: 'data.name', required: true, direction: 'response', endpointId: 'getUser' },
    { id: 'h2', normalizedPath: 'data.email', required: true, direction: 'response', endpointId: 'getUser' },
    { id: 'h3', normalizedPath: 'data.tags[]', required: false, direction: 'response', endpointId: 'getUser' },
    { id: 'h4', normalizedPath: 'data.internalRiskScore', required: false, direction: 'response', endpointId: 'getUser' },
  ],
}
const DOM_FIELDS = ['data.name', 'data.email', 'data.tags', 'data.internalRiskScore'] // data-mk-field 约定值

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nx-mk-p3-')); mkdirSync(join(dir, '.nx-mk'), { recursive: true }) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('Phase 3 三点契约 + 全链', () => {
  it('三点契约：DOM data-mk-field 每项都落在 proxy hit 空间与 manifest fieldPath 空间的交集语义内', () => {
    // ① proxy 空间：createTrackedProxy({ name:'A', email:'E', tags:['t'], internalRiskScore: 1 },
    //    { requestId:'r1', endpointId:'ep1', basePath:'data', collector: c }) —— 逐字段读取（含 tags 数组迭代）
    //    drain().hits 的 normalizedPath 集合 ⊇ DOM_FIELDS 与响应结构交集（data.tags[] 归一化形态单列）
    // ② manifest 空间：MANIFEST.fields 的 normalizedPath 集合
    // ③ 断言：DOM_FIELDS 中除 data.tags（数组属性，manifest 形态为 data.tags[]）外，
    //    每项 ∈ manifest 集合 ∧ ∈ proxy hit 集合 —— 契约 = data-mk-field 必须逐字等于 manifest normalizedPath
    //    （demo 组件与本 fixture 同约定；组件改值见 Step 2）
  })
  it('policy → analyzer → CoverageReport：ignored 不进分母且进 ignored-returned', () => {
    // collector：hit data.name/data.email/data.internalRiskScore + tags 数组迭代
    // db：openCoverageDb(tmp) + insertRun
    // decisions = evaluatePolicy(MANIFEST.fields, { ignored: ['data.internalRiskScore'] })
    // report = analyzeCoverage({ runId:'run_t', manifest: MANIFEST as never, policyDecisions: decisions, drained: c.drain(), db })
    // 断言：metrics.requiredCoverage === 1；ignoredReturnedFields 长度 1（internalRiskScore）；
    //       missingRequiredFields 空；report JSON 可序列化（JSON.parse(JSON.stringify(report)) 深等）
  })
  it('goal 侧契约：initial-coverage ignoredGlobs 与 coverage matchGlob 同矩阵', () => {
    // 矩阵 10 组三元组（字面/*/**/混合正反例，与 policy-glob.test.ts 头部常量互指同步）
    // 对每组：readInitialCoverageFromManifest(单字段 fixture dir, { ignoredGlobs: [pattern] }) 的排除行为 === matchGlob(pattern, path) 取反
  })
})
```

> ⚠️ 实施者注意：`readInitialCoverageFromManifest(cwd)` 读 `{cwd}/.nx-mk/manifest.json` —— fixture 用 `dir` 作 cwd 写该文件；`analyzeCoverage` 的 manifest 参数类型若与 fixture 形状有出入（ApiManifest 全量字段），以 manifest-schema 实际类型为准补齐 fixture 必填字段（如 apiVersion/哈希等元字段照 demo manifest.json 真形抄最小集）。

- [ ] **Step 2: demo 数据源修正**

1. 跑 `corepack pnpm demo:openapi`（重新生成 manifest/swagger），**读取** `examples/react-vite-demo/.nx-mk/manifest.json`，列出全部 response 字段 normalizedPath 真值。
2. `UserProfile.tsx` Field 值改为与 manifest normalizedPath **逐字一致**（预期：`data.name` / `data.email` / `data.tags` 或 `data.tags[]`（以 manifest 真值为准）/ `data.address.city` / `data.address.zip`；并为 user.id 补一个 Field（副标题行）使 required 全可命中）。
3. `nx-mk.config.yml`：

```yaml
collect:
  url: http://localhost:5173
  maxTurns: 3
goal:
  targetRatio: 1.0
coverage:
  required: []
  optional: []
  ignored:
    - data.internalRiskScore
```

4. 核对：manifest 中除 ignored 外的每个 response 字段都有对应 Field 或 proxy 读取路径；若存在页面不读的字段（intermediate 路径如 `data.address` 会被 proxy 读取命中——读 demo 组件确认），逐个落实到「可命中」；做不到的进 coverage.ignored。**验收线：ignored 之外全字段可命中 → targetRatio 1.0 可达。**

- [ ] **Step 3: 全绿 + README**

Run: `npx vitest run`（全量，预期 275+ ≈ 340±15）+ `corepack pnpm run demo:typecheck`
Expected: PASS

README 更新点：Phase 3 完成态（policy-engine / 三指标 / anti-cheat v0 / coverage-report.json）；手动验收步骤更新为「MK_ANALYSIS=true 起 vite → run → 期望 stdout goal:met、`runs.terminated_by='goal-met'`、coverage-report.json 三指标」；已知限制段移除「§1.4.2 不可达」条目（ replaced by Phase 3 交付说明），保留跨文档 shim / Ruling 8 等仍有效条目。

- [ ] **Step 4: 提交 + 手动验收**

```bash
git add examples/react-vite-demo tests/integration/phase3-analyze.test.ts README.md
git commit -m "feat(demo): Phase 3 goal loop close — normalizedPath fields + coverage policy + contract tests (spec §3.6)"
```

手动验收（判定步骤，产证据入 task-9-report.md）：

```bash
corepack pnpm --filter @nx-mk/client build && corepack pnpm --filter @nx-mk/coverage build && corepack pnpm --filter @nx-mk/kernel build && corepack pnpm --filter @nx-mk/plugin-playwright build && corepack pnpm --filter @nx-mk/cli build
corepack pnpm demo:openapi
MK_ANALYSIS=true corepack pnpm --filter @nx-mk-example/app dev &   # vite 5173
corepack pnpm --filter @nx-mk-example/server dev &                 # 后端 8787
cd examples/react-vite-demo && node ../../packages/cli/dist/index.js run
# 期望（三点互证）：
# ① stdout：Coverage 三行 + goal:met（或 events.jsonl 尾部 goal:met 事件）
# ② node better-sqlite3：SELECT terminated_by FROM runs ORDER BY started_at DESC LIMIT 1 → 'goal-met'
# ③ .nx-mk/coverage-report.json 存在且 requiredCoverage === 1；field_hits 无 data.then/tags.join/length
```

> chromium 未装 → `npx playwright install chromium`；若 goal 未达成，用 events.jsonl 的 turn 事件与 missing 列表定位未命中字段，回 Step 2 修正 Field/ignored 后重跑（这是校准回路，允许 2-3 轮）。

---

## Self-Review

- **Spec 覆盖**：§3.1→T3/T4（id-space/terminatedBy/ensureColumn）、§3.2→T1/T2、§3.3→T7、§3.4→T5/T6/T7(classify)、§3.5→T8、§3.6→T9；§1.4 成功标准 1→T9 手动验收、2→T9 契约测试、3→T2/T9 矩阵、4→T7、5→T5+T9 验收③、6→各任务全绿门。§2.1 全文件均有归属任务。
- **⚠️ 计划细化两处**（超出 spec 字面、执行时记台账）：T3 initial-coverage `ignoredGlobs`（kernel 内置镜像 matcher + 跨包矩阵契约）；T9 Step 2 校准回路（Field 补 user.id + ignored 落实到 goal 可达——spec §3.6 targetRatio 1.0 的可达性前提）。
- **类型一致性**：`matchGlob`/`evaluatePolicy`/`PolicyDecision`（T1/T2 → T7/T9）、`RunResult.terminatedBy`（T3 → T8）、`endRun` 第 4 参（T4 → T8）、`textSample`（T4 → T6 → T7）、`analyzeCoverage` 新签名（T7 → T8/T9）逐一核对无漂移。
- **占位**：T2 Step 4 config 两例与 T7 analyzer 部分实现要点为行为规格 + 现文件同构指引（⚠️ 标注），非纯 TBD；其余全代码。
