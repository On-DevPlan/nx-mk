# nx-mk Goal-Oriented Multi-Turn Loop 设计方案

> **设计报告（供审阅）** · 生成日期: 2026-08-28
> 范围: `run` 阶段内部的多轮目标驱动采集循环
> 前置: [`2026-08-28-foundation-modification-plan.md`](./2026-08-28-foundation-modification-plan.md)（M1-M5）、[`2026-08-28-lifecycle-loop-extensibility-preview.md`](./2026-08-28-lifecycle-loop-extensibility-preview.md)（可扩展性预留）

---

## 0. 阅读对象与目的

本文针对 nx-mk `run` 阶段的内部执行模型，回答以下问题：

1. **为什么需要多轮**：单轮采集无法达到 100% 覆盖率
2. **为什么需要目标驱动**：终止条件不是"所有 worker done"，而是"目标达成"
3. **数据如何流动**：每轮边界、聚合点、终止决策的完整路径
4. **复杂度多大**：与 dsh ReactLoopAgent 的对比

**核心结论**：

- 多轮 + 覆盖率目标终止 = **Goal-Oriented Multi-Turn Orchestrator**
- 与 dsh 的 ReactLoopAgent 同量级（~600 行 runtime 代码）
- 比纯 Pub/Sub / CollectionLoop 重得多，但确实是必要的复杂度

---

## 1. 背景与动机

### 1.1 nx-mk 当前 `run` 阶段模型

```ts
} else if (phase === 'run') {
  await runHooksForPhaseWithCapture(phase, 'before', plugins, buildCtx())
  await runHooksForPhaseWithCapture(phase, 'after', plugins, buildCtx())
}
```

**问题**：

- 单轮触发，无法支持"持续收集直到达标"
- 没有"覆盖率"概念，插件被强制在 `afterRun` 之前完成
- 多源异步数据（SDK 拦截 / 浏览器证据 / CI 历史）无法在单轮内汇聚

### 1.2 真实场景分析

nx-mk 的核心工作流：

```
parse OpenAPI → 生成 Manifest → 注入 SDK Facade → 采集数据 → 计算 coverage → 写报告
```

其中"采集数据"步骤**天然是异步多源**：

| 数据源 | 异步性 | 终止条件 |
|--------|--------|----------|
| SDK 拦截器（运行时） | 持续上报 | 用户行为停止 |
| 浏览器扩展（UI 证据） | 持续上报 | 用户停止访问 |
| CI 历史数据 | 一次性 | 数据到达即终止 |
| 测试运行 | 一次性 | 测试完成 |

这些数据源**各自异步产生、到达时间不确定、需要全部汇聚后才能计算覆盖率**。

### 1.3 为什么必须多轮

单轮采集的实际困境：

```
Turn 1:
  SDK 拦截到 5 个 endpoint 调用
  浏览器上报 3 个 route 访问
  覆盖率 = 8/20 = 40%

如果 Turn 1 后就退出 → 覆盖率永远卡在 40%
```

**多轮的意义**：

- 每一轮给插件时间收集更多数据
- 内核在每轮结束后计算覆盖率
- 决定继续（覆盖率 < 目标）还是退出（覆盖率 ≥ 目标）

### 1.4 为什么必须目标驱动

如果用"所有 worker done"作为终止条件：

```
Plugin A: "我还在监听，下一轮可能有数据"  → idle
Plugin B: "我还在监听"                    → idle
Plugin C: "我暂时没有数据"                 → idle

三个插件都 idle，但覆盖率可能才 70%
是退出（"都 done"）还是继续（"还没到 100%"）？
```

**目标驱动** = 让内核有明确标准判断"是否足够"。

---

## 2. 总体架构

### 2.1 模式识别

本设计是 **Goal-Oriented Multi-Turn Orchestrator**（目标驱动的多轮协调器），融合了三种模式：

| 模式 | 来源 | 作用 |
|------|------|------|
| Coordinator-Worker | dsh ReactLoopAgent | 内核协调，插件自主 |
| Goal-Driven Termination | Goal-Oriented Planning | 覆盖率目标作为终止条件 |
| Event-Scoped State | Observable Workers | turn-scoped state + 跨轮持久 |

### 2.2 与 dsh ReactLoopAgent 的对应

| dsh 组件 | nx-mk 对应 | 行数估算 |
|----------|------------|----------|
| `Phase = idle \| maintenance \| running` | `GoalResult = met \| unmet \| aborted` | ~80 |
| `turn` / `step` 多轮 | `turn` 单轮 | ~30 |
| `Inbox.inserted / claimed / discarded` | `emitReport` + turn-scoped queue | ~100 |
| `session events log` | 复用 `events.jsonl` + coverage state | ~50 |
| `AbortController` | 同 | ~30 |
| `RuntimeContextProjection` | `Coverage` 计算模块 | ~100 |
| `wakeRequested` / 唤醒机制 | 进展检测（compare coverage N vs N-1） | ~50 |
| `AgentEventDispatch` 预编译 | 不做（频率低） | 0 |
| 类型 + 测试 + 文档 | | ~150 |
| **总计** | | **~600 行** |

**与 dsh 同量级，但更专注**：无多轮对话、无 session 持久化、无 inbox claim 语义。

---

## 3. 数据流

### 3.1 Turn 循环主流程

```
              ┌────────────────────────────────────────┐
              │         Goal-Oriented Loop             │
              │                                        │
              │   ┌──────────────────────────┐         │
              │   │ turn:start { turn: N }   │         │
              │   └────────────┬─────────────┘         │
              │                ▼                       │
              │   ┌──────────────────────────┐         │
              │   │ plugins process turn     │         │
              │   │ (collect / analyze)      │         │
              │   └────────────┬─────────────┘         │
              │                ▼                       │
              │   ┌──────────────────────────┐         │
              │   │ plugins emitReport       │         │
              │   │ + emitSignal             │         │
              │   └────────────┬─────────────┘         │
              │                ▼                       │
              │   ┌──────────────────────────┐         │
              │   │ turn:end { turn: N }     │         │
              │   │ + drain pending          │         │
              │   └────────────┬─────────────┘         │
              │                ▼                       │
              │   ┌──────────────────────────┐         │
              │   │ compute coverage[N]      │         │
              │   └────────────┬─────────────┘         │
              │                ▼                       │
              │   ┌──────────────────────────┐         │
              │   │ check progress:          │         │
              │   │   coverage[N] vs [N-1]   │         │
              │   └────────────┬─────────────┘         │
              │                ▼                       │
              │   ┌──────────────────────────┐         │
              │   │ check termination:       │         │
              │   │   - ratio >= target?     │         │
              │   │   - max turns?           │         │
              │   │   - idle limit?          │         │
              │   │   - absolute timeout?    │         │
              │   │   - signal.aborted?      │         │
              │   └─────┬──────────┬─────────�         │
              │         │met       │unmet              │
              │         ▼          ▼                   │
              │   ┌─────────┐  ┌──────────┐            │
              │   │ goal:met│  │goal:unmet│            │
              │   │ + exit  │  │ + exit   │            │
              │   └─────────┘  └──────────┘            │
              │                                        │
              │  else → continue (next turn)           │
              └────────────────────────────────────────┘
```

### 3.2 数据汇聚路径

```
Plugins 发出              Kernel 处理                  产出
─────────────────        ──────────────────          ─────────────
                                                      
emitReport ────────────► reports[N].push(report) ───► Coverage.missing
                          │                          ▲  = 总数 - covered
                          ▼                          │
emitSignal(idle) ───────► pluginStates[A].idle ─────►│
                          │                          │
emitSignal(done) ───────► pluginStates[A].done ─────►│
                          │                          │
                          └─► turn:end ──────────────┤
                                  │                 │
                                  ▼                 │
                          computeCoverage() ────────�
                          (聚合 reports + manifest
                           + previous coverage)
                                  │
                                  ▼
                          coverage[N] = { ratio, missing }
                                  │
                                  ▼
                          progressCheck:
                            if coverage[N].ratio == coverage[N-1].ratio
                              → idleTurns++
                            else
                              → idleTurns = 0
                                  │
                                  ▼
                          emit 'turn:progress' { idleTurns, ratio }
```

### 3.3 终止决策表

| 优先级 | 条件 | 结果 |
|--------|------|------|
| 1 | `signal.aborted` | 立即退出（aborted） |
| 2 | `coverage.ratio >= targetRatio` | 优雅退出（goal:met） |
| 3 | `turnN >= maxTurns` | 强制退出（goal:unmet, reason: max-turns） |
| 4 | `idleTurns >= idleTurnsLimit` | 强制退出（goal:unmet, reason: idle） |
| 5 | `Date.now() - startedAt >= absoluteTimeoutMs` | 强制退出（goal:unmet, reason: timeout） |
| 6 | 所有 active 插件都发 failed | 强制退出（goal:unmet, reason: all-failed） |

**资源保护优先**（bounds 永远在 predicate 之前）。

---

## 4. 核心类型

### 4.1 Coverage（新增）

```ts
// packages/kernel/src/coverage.ts

export interface Coverage {
  total: number
  covered: number
  ratio: number              // covered / total
  missing: MissingItem[]
}

export type MissingItem =
  | { kind: 'endpoint'; method: string; path: string }
  | { kind: 'route'; route: string; component?: string }
  | { kind: 'field'; fieldId: string }
  | { kind: 'schema'; path: string }
```

### 4.2 Goal 配置

```ts
export interface GoalConfig {
  /** 目标覆盖率（默认 1.0 = 100%） */
  targetRatio: number
  
  /** 最大 turn 数（默认 100） */
  maxTurns: number
  
  /** 连续无进展 turn 数上限（默认 3） */
  idleTurnsLimit: number
  
  /** 整体超时（默认 600000ms = 10 分钟） */
  absoluteTimeoutMs: number
}
```

### 4.3 Worker State

```ts
export type PluginWorkerState =
  | { kind: 'active'; reportsEmitted: number; lastActivityAt: string }
  | { kind: 'done'; reason: string; finalReportCount: number; finishedAt: string }
  | { kind: 'failed'; error: { code: string; message: string }; failedAt: string }
```

### 4.4 Goal Result

```ts
export interface GoalResult {
  kind: 'met' | 'unmet' | 'aborted'
  coverage: Coverage
  turns: number
  durationMs: number
  reports: PluginReport[]
  pluginStates: Map<PluginName, PluginWorkerState>
  terminatedBy: 'goal-met' | 'max-turns' | 'idle' | 'timeout' | 'aborted' | 'all-failed'
}
```

### 4.5 Plugin 侧类型

```ts
export type PluginReport =
  | { kind: 'endpoint-called'; method: string; path: string; turn: number }
  | { kind: 'route-visited'; route: string; turn: number }
  | { kind: 'field-hit'; fieldId: string; count: number; turn: number }
  | { kind: 'no-data'; reason: string; turn: number }
  | { kind: 'analysis'; missing: MissingItem[]; recommendations: string[]; turn: number }

export type PluginSignal =
  | { kind: 'idle'; turn: number }
  | { kind: 'done'; reason: 'all-collected' | 'timeout'; turn: number }
  | { kind: 'failed'; error: { code: string; message: string }; turn: number }
```

### 4.6 新增 KernelEvent

```ts
export type KernelEvent =
  | /* ... 已有事件 ... */
  | { type: 'turn:start'; turn: number; timestamp: string; idleTurns: number }
  | { 
      type: 'turn:end'
      turn: number
      timestamp: string
      coverage: Coverage
      progress: 'improved' | 'stagnant' | 'regressed'
    }
  | { type: 'goal:met'; coverage: Coverage; turns: number; durationMs: number }
  | {
      type: 'goal:unmet'
      reason: 'max-turns' | 'idle' | 'timeout' | 'all-failed'
      coverage: Coverage
      turns: number
    }
```

---

## 5. PluginContext 扩展

```ts
export interface PluginContext {
  // ... 已有字段
  
  // 报告产出（带 turn 上下文）
  emitReport(report: PluginReport): void
  
  // 完成信号
  emitSignal(signal: PluginSignal): void
  
  // 查询当前 turn 与进度
  getTurn(): number
  getCoverage(): Coverage
  getMissing(): MissingItem[]
  getIdleTurns(): number
}
```

---

## 6. Kernel Loop 实现骨架

### 6.1 主循环

```ts
// packages/kernel/src/goal-loop.ts

export async function runGoalLoop(opts: {
  plugins: Plugin[]
  goal: GoalConfig
  initialCoverage: Coverage
  ctx: PluginContext
  signal: AbortSignal
}): Promise<GoalResult> {
  const startTime = Date.now()
  const reports: PluginReport[] = []
  const pluginStates = new Map<PluginName, PluginWorkerState>()
  let coverage = opts.initialCoverage
  let idleTurns = 0
  let turn = 0
  
  // 初始化所有插件为 active
  for (const p of opts.plugins) {
    pluginStates.set(p.name, {
      kind: 'active',
      reportsEmitted: 0,
      lastActivityAt: new Date().toISOString(),
    })
  }
  
  // 注入 emit 方法到 ctx
  const ctx = attachEmitMethods(opts.ctx, { reports, pluginStates, getTurn: () => turn })
  
  while (true) {
    turn++
    
    // 1. 边界检查（先于 predicate）
    if (opts.signal.aborted) {
      return buildResult('aborted', 'aborted', coverage, turn, reports, pluginStates, startTime)
    }
    if (Date.now() - startTime >= opts.goal.absoluteTimeoutMs) {
      return buildResult('unmet', 'timeout', coverage, turn, reports, pluginStates, startTime)
    }
    if (turn > opts.goal.maxTurns) {
      return buildResult('unmet', 'max-turns', coverage, turn, reports, pluginStates, startTime)
    }
    if (idleTurns >= opts.goal.idleTurnsLimit) {
      return buildResult('unmet', 'idle', coverage, turn, reports, pluginStates, startTime)
    }
    if (allPluginsFailed(pluginStates)) {
      return buildResult('unmet', 'all-failed', coverage, turn, reports, pluginStates, startTime)
    }
    
    // 2. turn 起点
    events.emit({
      type: 'turn:start',
      turn,
      timestamp: new Date().toISOString(),
      idleTurns,
    })
    
    // 3. 等待插件完成本轮工作
    await runTurn({ plugins, turn, ctx })
    
    // 4. turn 终点 + 计算新覆盖率
    const previousRatio = coverage.ratio
    coverage = computeCoverage(reports, opts.initialCoverage)
    const progress: 'improved' | 'stagnant' | 'regressed' =
      coverage.ratio > previousRatio ? 'improved' :
      coverage.ratio < previousRatio ? 'regressed' :
      'stagnant'
    
    if (progress === 'stagnant') idleTurns++
    else idleTurns = 0
    
    events.emit({
      type: 'turn:end',
      turn,
      timestamp: new Date().toISOString(),
      coverage,
      progress,
    })
    
    // 5. 目标检查
    if (coverage.ratio >= opts.goal.targetRatio) {
      return buildResult('met', 'goal-met', coverage, turn, reports, pluginStates, startTime)
    }
  }
}
```

### 6.2 单轮执行

```ts
async function runTurn(opts: {
  plugins: Plugin[]
  turn: number
  ctx: PluginContext
}): Promise<void> {
  // 触发所有插件的 onTurnStart 钩子（M15 扩展点）
  // 或者让插件通过 emitSignal(idle/done) 自主控制
  
  // 当前实现：等待固定时长后 drain
  // Phase 2+：插件可通过 ctx.signal 主动结束本轮
  await waitForTurnCompletion(opts.ctx)
  
  // drain pending reports
  await drainMicrotasks()
}
```

### 6.3 Coverage 计算

```ts
function computeCoverage(reports: PluginReport[], initial: Coverage): Coverage {
  // 收集所有已覆盖项
  const covered = new Set<string>()
  for (const report of reports) {
    if (report.kind === 'endpoint-called') {
      covered.add(`${report.method} ${report.path}`)
    } else if (report.kind === 'route-visited') {
      covered.add(report.route)
    } else if (report.kind === 'field-hit') {
      covered.add(report.fieldId)
    }
  }
  
  // 从 initial.missing 中过滤出仍未覆盖的
  const missing = initial.missing.filter(item => {
    const key = item.kind === 'endpoint' ? `${item.method} ${item.path}` :
                item.kind === 'route' ? item.route :
                item.kind === 'field' ? item.fieldId :
                item.path
    return !covered.has(key)
  })
  
  return {
    total: initial.total,
    covered: initial.total - missing.length,
    ratio: (initial.total - missing.length) / initial.total,
    missing,
  }
}
```

---

## 7. 典型执行序列

### 7.1 Happy Path（覆盖率 0% → 100%）

```
config = {
  targetRatio: 1.0,
  maxTurns: 100,
  idleTurnsLimit: 3,
  absoluteTimeoutMs: 600000
}
initialCoverage = { total: 20, covered: 0, ratio: 0, missing: [20 endpoints] }

Turn 1:
  emit 'turn:start { turn: 1, idleTurns: 0 }'
  Plugin A: emitReport (endpoint-called ×5)
  Plugin B: emitReport (route-visited ×3)
  Plugin C: emitSignal (idle)
  emit 'turn:end { turn: 1, coverage: { 8/20 = 40% }, progress: improved }'
  → continue

Turn 2:
  emit 'turn:start { turn: 2, idleTurns: 0 }'
  Plugin A: emitReport (endpoint-called ×4)
  Plugin B: emitReport (route-visited ×2)
  Plugin C: emitReport (analysis: 6 endpoints still missing, recommend tests X/Y/Z)
  emit 'turn:end { turn: 2, coverage: { 14/20 = 70% }, progress: improved }'
  → continue

Turn 3:
  emit 'turn:start { turn: 3, idleTurns: 0 }'
  Plugin A: emitReport (endpoint-called ×2)
  Plugin B: no new (signal idle)
  Plugin C: emitReport (analysis: 4 endpoints remaining)
  emit 'turn:end { turn: 3, coverage: { 16/20 = 80% }, progress: improved }'
  → continue

Turn 4:
  emit 'turn:start { turn: 4, idleTurns: 0 }'
  Plugin A: emitReport (endpoint-called ×4) — last 4
  Plugin B: emitReport (route-visited ×1) — last route
  Plugin C: emitSignal (done, reason: 'all-collected')
  emit 'turn:end { turn: 4, coverage: { 20/20 = 100% }, progress: improved }'
  → ratio >= 1.0 → emit 'goal:met'
  → exit loop

Final:
  GoalResult {
    kind: 'met',
    coverage: { total: 20, covered: 20, ratio: 1.0, missing: [] },
    turns: 4,
    durationMs: 87234,
    reports: [13 endpoint-called, 6 route-visited, 2 analysis, 0 no-data],
    terminatedBy: 'goal-met',
  }
```

### 7.2 Stuck Path（覆盖率卡在 95%）

```
Turn 5:
  emit 'turn:start { turn: 5, idleTurns: 0 }'
  Plugin A: emitReport (endpoint-called ×1) → coverage 19/20 = 95%
  emit 'turn:end { turn: 5, coverage: { 19/20 = 95% }, progress: improved }'

Turn 6:
  emit 'turn:start { turn: 6, idleTurns: 0 }'
  Plugin A: no new (signal idle)
  Plugin B: no new (signal idle)
  Plugin C: emitReport (analysis: 1 endpoint unreachable from frontend)
  emit 'turn:end { turn: 6, coverage: { 19/20 = 95% }, progress: stagnant }'
  → idleTurns = 1

Turn 7:
  (no new reports from any plugin)
  emit 'turn:end { turn: 7, coverage: { 19/20 = 95% }, progress: stagnant }'
  → idleTurns = 2

Turn 8:
  (no new reports)
  emit 'turn:end { turn: 8, coverage: { 19/20 = 95% }, progress: stagnant }'
  → idleTurns = 3 → idleTurnsLimit reached
  → emit 'goal:unmet { reason: "idle", coverage: { 19/20 = 95% } }'

Final:
  GoalResult {
    kind: 'unmet',
    terminatedBy: 'idle',
    coverage: { total: 20, covered: 19, ratio: 0.95, missing: [1 unreachable endpoint] },
    turns: 8,
    ...
  }
```

**优雅退出**——不会无限循环，留下 missing 让用户决策。

---

## 8. 插件实现样板

### 8.1 SDK 拦截器

```ts
export const configSchema = z.object({
  minSamples: z.number().int().positive().default(10),
})

export default createPlugin({ inject: ['events'] }, (ctx) => {
  let collected = 0
  
  // 订阅 SDK 上报事件
  const unsub = ctx.events.on('sdk/request', (req) => {
    ctx.emitReport({
      kind: 'endpoint-called',
      method: req.method,
      path: req.path,
      turn: ctx.getTurn(),
    })
    collected++
  })
  
  // 每轮检查是否达标
  ctx.events.on('turn:start', () => {
    if (collected >= ctx.config.minSamples) {
      ctx.emitSignal({ kind: 'done', reason: 'all-collected', turn: ctx.getTurn() })
    } else {
      ctx.emitSignal({ kind: 'idle', turn: ctx.getTurn() })
    }
  })
  
  return {
    name: 'plugin-sdk-interceptor',
    version: '0.1.0',
    hooks: { ... },
  }
})
```

### 8.2 浏览器证据

```ts
export const configSchema = z.object({
  evidenceDir: z.string(),
})

export default createPlugin({ inject: ['events', 'fs'] }, (ctx) => {
  ctx.events.on('browser/screenshot', async (shot) => {
    const route = await inferRoute(shot)
    ctx.emitReport({
      kind: 'route-visited',
      route,
      turn: ctx.getTurn(),
    })
  })
  
  return { name: 'plugin-browser-evidence', version: '0.1.0', hooks: { ... } }
})
```

### 8.3 分析插件（提供 missing 反馈）

```ts
export default createPlugin({ inject: ['events'] }, (ctx) => {
  ctx.events.on('turn:end', () => {
    const missing = ctx.getMissing()
    if (missing.length > 0) {
      ctx.emitReport({
        kind: 'analysis',
        missing,
        recommendations: missing.map(item => generateRecommendation(item)),
        turn: ctx.getTurn(),
      })
    }
  })
  
  return { name: 'plugin-coverage-advisor', version: '0.1.0', hooks: { ... } }
})
```

---

## 9. 与现有 5 阶段模型的衔接

```ts
// packages/kernel/src/kernel.ts (run 阶段改造)

} else if (phase === 'run') {
  await runHooksForPhaseWithCapture(phase, 'before', plugins, buildCtx())
  
  // Goal Loop 替代原 afterRun 钩子
  const goalResult = await runGoalLoop({
    plugins,
    goal: config.goal ?? {
      targetRatio: 1.0,
      maxTurns: 100,
      idleTurnsLimit: 3,
      absoluteTimeoutMs: 600000,
    },
    initialCoverage: buildInitialCoverage(manifest),
    ctx: buildCtx(),
    signal: shutdownController.signal,
  })
  
  state.collectionResult = goalResult  // 暴露给 afterRun
  
  await runHooksForPhaseWithCapture(phase, 'after', plugins, buildCtx())
}
```

**`afterRun` 钩子可读 `ctx.collectionResult`** 做最终处理（写报告）。

---

## 10. 配置集成

```yaml
# nx-mk.config.yml
plugins:
  - plugin-swagger
  - plugin-sdk-interceptor
  - plugin-browser-evidence
  - plugin-coverage-advisor

goal:
  targetRatio: 1.0          # 默认 100%
  maxTurns: 100
  idleTurnsLimit: 3
  absoluteTimeoutMs: 600000
```

---

## 11. 复杂度估算

| 组件 | 行数 |
|------|------|
| `coverage.ts`（Coverage 类型 + 计算） | ~120 |
| `goal-loop.ts`（turn 循环驱动） | ~200 |
| `progress-check.ts`（进展检测 + idle 计算） | ~50 |
| PluginContext 扩展 | ~30 |
| KernelEvent 新增 | ~30 |
| 类型与导出 | ~30 |
| 单元测试 | ~250 |
| 集成测试 | ~100 |
| 文档 | ~80 |
| **总计** | **~890 行**（含测试） |
| **核心 runtime 代码** | **~460 行** |

**与 dsh ReactLoopAgent 同量级**，但更专注。

---

## 12. 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| Coverage 计算归属 | **内核**（不是插件） | 防止插件自报覆盖率造假 |
| Turn 边界触发 | **内核驱动**（每轮 yield to event loop） | 简化插件逻辑 |
| 进展检测 | **ratio 对比**（连续两 turn ratio 不变 → idle） | 简单可靠 |
| 终止优先级 | signal > goal-met > bounds | 资源保护优先 |
| 持久化 | **复用 events.jsonl** + 新增 turn 事件 | 不引入新格式 |
| Goal 配置 | **config 内声明**（每个项目可定制） | 不是硬编码 100% |
| 失败处理 | **failed 插件不阻塞 loop**（其他插件继续） | 解耦局部失败 |
| 插件 turn 感知 | **可选**（插件可查询，但不强制） | 简单插件可不读 |
| Inbox claim 语义 | **不做**（plugin-swagger 等简单插件不需要） | 简化复杂度 |
| 多轮 step 语义 | **不做**（nx-mk 是单轮内的多 turn，不是 turn 内的多 step） | dsh 才有此需求 |

---

## 13. 与 M1-M5 关系

| M | 关系 |
|---|------|
| M1 状态机 | 复用 `PluginWorkerState`（3 态 active/done/failed） |
| M2 schema | 插件用 `configSchema` 声明 GoalConfig 子集 |
| M3 inject | `ctx.coverage` / `ctx.events` 等服务通过 inject 提供 |
| M5 types | `Coverage` / `GoalResult` 用 branded type |

**M14 Goal Loop 依赖 M1-M5 完成**，不重做 M1-M5 的工作。

---

## 14. 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| 插件忘记 emitSignal 导致永久阻塞 | 高 | idleTurns + absoluteTimeoutMs 强制退出 |
| 假数据循环（插件重复发相同 report） | 中 | progress check 基于 ratio 而非 report 数 |
| Coverage 计算遗漏某种 report 类型 | 中 | computeCoverage 强制处理所有 PluginReport 变体 + `assertNever` |
| 测试覆盖不足 | 中 | 三类场景：happy / stuck / aborted 各 5+ 测试 |
| 实现偏差 dsh 复杂度 | 低 | 严格按本文档骨架实现，不引入 Inbox/turn step |

---

## 15. 决策点（需审阅人确认）

### 15.1 核心场景

nx-mk 的核心用户场景是哪个？

- [ ] 单次分析（OpenAPI → Manifest → 报告）→ **不需要 Goal Loop**
- [ ] watch 模式持续监听 → **部分需要**
- [ ] CI 集成跑覆盖率（必须 100%）→ **需要**
- [ ] 多源汇聚（SDK + 浏览器 + CI）→ **强需要**

### 15.2 Goal 配置

- [ ] 默认 `targetRatio = 1.0`（100%）？
- [ ] 支持项目级 config 覆盖？
- [ ] 支持 turn-by-turn 调整 ratio？（M16+ 再说）

### 15.3 进展检测

- [ ] ratio 对比（推荐）？
- [ ] 还是 missing 数对比？
- [ ] 还是新 report 数对比？

### 15.4 失败容忍

- [ ] 单个插件 failed 不阻塞 loop（推荐）？
- [ ] 还是 hard fail（任一 failed 就 abort）？

### 15.5 实施时机

- [ ] M5 之后立即做（M14）？
- [ ] 先看 Phase 1 真实场景再决定？
- [ ] 仅在确有需求时做？

### 15.6 命名

- [ ] `runGoalLoop` / `GoalResult` / `Coverage` 命名是否清晰？
- [ ] 是否需要更领域化的命名（如 `runCoverageCollection`）？

### 15.7 与 afterRun 钩子关系

- [ ] 删除 `afterRun` 钩子（被 Goal Loop 替代）？
- [ ] 保留 `afterRun`，但文档明确"Goal Loop 完成后触发"？

---

## 16. 审阅签收

待审阅人确认 §15 决策点后，进入实现阶段。建议流程：

1. 决策点确认 → 锁定设计
2. 在 M5 完成的下一个 milestone 实施 M14
3. 用真实多源场景验证（plugin-sdk-interceptor + plugin-browser-evidence）
4. 验证成功 → 推广；验证发现 dsh 那种复杂度是真需要 → 重新评估是否引入 Inbox

---

## 附录 A：参考文件

### nx-mk 当前

- `packages/kernel/src/kernel.ts` — `runPhase` switch / 5 阶段驱动器
- `packages/kernel/src/event-bus.ts` — `KernelEvent` 判别联合
- `packages/kernel/src/plugin.ts` — `Plugin` / `PluginContext` / `KernelAPI`
- `packages/manifest/src/parser.ts` — OpenAPI 解析（initialCoverage 的来源）

### 前置方案

- [`2026-08-28-foundation-modification-plan.md`](./2026-08-28-foundation-modification-plan.md) — M1-M5 基础稳定性
- [`2026-08-28-lifecycle-loop-extensibility-preview.md`](./2026-08-28-lifecycle-loop-extensibility-preview.md) — 可扩展性预留
- [`2026-08-28-dsh-borrow-review.md`](./2026-08-28-dsh-borrow-review.md) — dsh 借鉴评估

### dsh 参考

- `.claude/repo/deepseek-harness/packages/core/agent-loop/src/agent.ts` — ReactLoopAgent 完整实现
- `.claude/repo/deepseek-harness/packages/core/agent-loop/src/runtime-context.ts` — RuntimeContextProjection
- `.claude/repo/deepseek-harness/vendor/cordis/src/fiber.ts` — Fiber 状态机
- `.claude/repo/deepseek-harness/packages/CLAUDE.md` — Agent initiator scope 约定

---

**Goal-Oriented Multi-Turn Loop 设计方案结束** · 等待审阅
