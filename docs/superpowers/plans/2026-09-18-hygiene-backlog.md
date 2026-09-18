# 卫生 Backlog 清零实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清零 `docs/hygiene-backlog.md` 全部 15 项卫生发现，修一项划一项，全程测试通过。

**Architecture:** 按工作形状分批 —— 测试/UI 微修批（10 项同形：加卫语句、改 fixture、改 UI 态、MIME 表、tmp 清理、static 竞态、typefix）；拆分/类型批（3 项需判断：kernel.ts 拆分、plugin-swagger fixture 对齐、analyzer unknown 分支单测）；配置/核验批（2 项收尾：esbuild override 验证或移除、analyzer 原子写包装）。每批结束跑 `npx vitest run` 全绿才进下一批。

**Tech Stack:** Node v22 (PATH prefix required); `corepack pnpm`; vitest; tsup; tsc --noEmit; better-sqlite3; fastify

**Spec:** `docs/hygiene-backlog.md`（本计划逐项对应 backlog 条目编号 A1-A7 / B1-B8）

## Global Constraints

- Windows + Git Bash；**所有** node/vitest/tsc/pnpm 命令前缀 `PATH=/c/Users/joke/AppData/Local/nvm/v22.23.2:$PATH`
- `corepack pnpm`；测试从仓库根 `npx vitest run`
- 文件 ≤400 行（A1 kernel 拆分的**动机**；拆分后单文件 ≤400）
- 中文注释 + 英文 CLI/测试输出
- ESM `.js` 后缀 import；verbatimModuleSyntax；noUncheckedIndexedAccess
- 不写 attribution 行（用户覆盖规则）
- 每批末尾跑全测试套绿屏才进入下一批
- `plugin-swagger` 包需要时可独立重建（`corepack pnpm -F @nx-mk/plugin-swagger build`）

---

## Task 1: 测试/UI 微修批（10 项）

**Files:**
- Modify: `packages/dashboard/src/ui/poller.ts`（A3 + A4）
- Modify: `packages/dashboard/src/server/static.ts`（A5 + A6）
- Modify: `packages/dashboard/src/ui/*.tsx`（B6 非 404 错误页 loading）
- Modify: `packages/dashboard/src/__tests__/*.test.ts`（B5 tmp 根泄漏）
- Test: 已有测试对应扩展 + 每个修复的新单测

**Produces:** A3/A4/A5/A6/B5/B6 修复 + 测试锁定；每项一条 commit（commit message 含 `closes hygiene-A3` 等标签）

- [ ] **Step 1: A3 — Poller.start() 幂等**

给 `Poller.start()` 加 timer 判空卫语句，重复调用不泄漏 interval：
```ts
start(): void {
  if (this.timer !== null) return // idempotent
  void this.refresh()
  this.timer = setInterval(() => void this.refresh(), this.opts.intervalMs ?? POLL_INTERVAL_MS)
}
```

- [ ] **Step 2: A4 — Poller.refresh 成功路径 aborted 卫语句**

`onUpdate` 前检查卫语句，被取代的旧响应不回调：
```ts
const data = await res.json()
if (controller.signal.aborted) return // superseded response, drop
this.opts.onUpdate(data)
```

- [ ] **Step 3: A5 — static 竞态 500 → 404**

把 `existsSync` + `readFile` 合并为单次 `readFile` + `catch ENOENT → 404`，消除 TOCTOU 窗口：
```ts
try {
  const body = await readFile(abs)
  return reply.type(type).send(body)
} catch (err) {
  if ((err as NodeJS.ErrnoException).code === 'ENOENT') return reply.code(404).send()
  throw err
}
```
同步删除不再使用的 `existsSync`/`statSync` 导入（verlet unused-import）。
测试扩展：在 `static.test.ts` 中新增"文件在 existsSync 后 readFile 前消失 → 404"用例（用 mock 拦截 readFile 抛 ENOENT）。

- [ ] **Step 4: A6 — MIME 扩展表扩充**

补全常见前端资产扩展名：`.js`→`text/javascript`, `.css`→`text/css`, `.json`→`application/json`, `.svg`→`image/svg+xml`, `.png`→`image/png`, `.jpg`→`image/jpeg`, `.ico`→`image/x-icon`, `.woff2`→`font/woff2`, `.map`→`application/json`。

- [ ] **Step 5: B5 — dashboard fixtures tmp 根泄漏**

定位 dashboard `__tests__` 中任何用 `os.tmpdir()` 裸写 + 未清理的 fixture。改用 `mkdtemp` + afterEach `rm -rf`，或迁移到现有 test 工具中的 tmp helper。添加一个"用后即弃"的 fixture 测试用例。

- [ ] **Step 6: B6 — 非 404 错误页仍 loading**

定位 dashboard UI 页中 error state 仅按 `status === 404` 分支切换的渲染。扩展为"任何非 2xx 且非 404 显示错误码+消息"（取 error.body.detail 或 HTTP statusText）。测试：inject 500/503 后 UI 展示错误态而非 loading。

- [ ] **Step 7: B2 — analyzer `unknown` 分支单测（最低成本）**

在 `coverage/src/__tests__` 新增单测：构造 manifest 字段在 policy 中无对应 rule（`evaluatePolicy` 返回 `unknown`）→ `classifyEvidence` 不抛错、不计两分母。锁定 v0 行为。

- [ ] **Step 8: B3 — analyzer `startsWith` 弱判别 → noise-guard 锁定**

新增单测：字段 id 以 `then` 等 Promise 方法名开头 → 不产出 phantom field_hits（已有 behavior 则锁；若无则补）。

- [ ] **Step 9: B7 — drainBrowserCollector READ+CLEAR 原子（文档化）**

该条目属 client collector v0 多轮 turn 数据一致性。若 master 仍是两阶段 evaluate 且无单测，本任务仅**文档化**（在 analyzer 或 collector 注释处加一行 `// v0: 多轮 turn 共用脚本应单次 evaluate 读+清，避免中间 push 丢数据`），不动结构。后续 4.5 重写 collector 时处理。

- [ ] **Step 10: B8 — collector/proxy index re-exports 卫生**

扫描 client 包的 index/re-export 文件，把 `export *` 或冗余 alias 显式化。完成后跑 `pnpm -F @nx-mk/client tsc --noEmit`（或根 typecheck）。

- [ ] **Step 11: 批测试验证**

`npx vitest run` 全绿。失败则本批定位修复后再进 Task 2。

---

## Task 2: 类型/对齐批（3 项）

**Files:**
- Modify: `packages/plugin-swagger/src/__tests__/index.test.ts`（A2）
- Modify: `packages/coverage/src/analyzer/coverage-analyzer.ts` + tests（B1 包装 + B3）
- Test: `packages/plugin-swagger/src/__tests__/index.test.ts`

**Produces:** A2 plugin-swagger typecheck 绿；B1 coverage_fields 原子写包装（事务）；B3 兜底覆盖

- [ ] **Step 1: A2 — plugin-swagger fixture 对齐 kernel 类型**

当前两处失败：
1. line 38 `{} as KernelState` 缺 `pluginStates` → 从 `@nx-mk/kernel` 导入 `KernelState` 的 fixture helper 或加字段
2. line 42 `PluginContext` 缺 `emitReport/emitSignal/getTurn/getCoverage/getMissing` → 用现有 kernel `__tests__` fixture 构造完整 `PluginContext`（参考 `packages/kernel/src/__tests__/hooks.test.ts` 的 fixture 模式）

目标：`pnpm -F @nx-mk/plugin-swagger exec tsc --noEmit` exit 0。

- [ ] **Step 2: B1 — coverage_fields + field_hits + ui_evidence 三表事务包装**

在 analyzer IO 层把多表 INSERT 包进 `db.transaction(() => { ... })`。失败 run 部分落库 → 失败 run 零落库（原子回滚）。新增事务测试：在 transaction 中途抛错 → 三表都无残留。

- [ ] **Step 3: B3 — startsWith 兜底（若 Task 1 Step 8 未做）**

单测：字段 id 命中 `METHOD_NAME_BLOCKLIST`（如 `then`, `constructor`）→ 不产出 field_hits。否则 analyzer 仍需独立断言兜底。

- [ ] **Step 4: 批测试 + typecheck 验证**

`npx vitest run` 全绿 + `pnpm -F @nx-mk/plugin-swagger exec tsc --noEmit` exit 0。

---

## Task 3: 核验/配置批（2 项）

**Files:**
- Read/Verify: 根 `package.json`（A7）
- Modify（如决策移除/降级）: 根 `package.json` + README 记录

**Produces:** A7 esbuild override 决策（保留并文档化 vs 降级绕开）

- [ ] **Step 1: A7 — esbuild override 决策**

核实根 `package.json` `pnpm.overrides` 或 `residualDependencies` 中 `esbuild ^0.27.0` 仍存在。判断：
- 若仍卡死 demo app vite 构建（如 Phase 4 时 stash 验证）→ 决定降级为 `^0.21.0`（vite 5 兼容）并在 README 记录 "demo 构建需要 esbuild < 0.25"
- 若 master 已自然修复 → 关闭 A7 条目

记录决策到 `docs/hygiene-backlog.md` 已修记录区。

- [ ] **Step 2: 全仓收尾验证**

全仓 `npx vitest run` + `pnpm -r exec tsc --noEmit`（或根 typecheck 脚本）全绿。

---

## Task 4: 落档闭环

**Files:**
- Modify: `docs/hygiene-backlog.md`

**Produces:** 全部 15 项标记 ☑ + 已修记录

- [ ] **Step 1: 标记 ☑**

遍历 A1-A7、B1-B8，已完成项在 `☐` 位置改为 `☑`，并在"已修记录"区追加一行：`A1 ☑ 2026-09-18 — kernel.ts 拆分至 400 行以下（commit <sha>）`。

- [ ] **Step 2: 提交落档**

`git commit -m "docs(hygiene): backlog 清零 —— 15 项全部划除"`

---

## 自检

- [ ] 每批全测试套绿屏
- [ ] `docs/hygiene-backlog.md` 状态与实际一致
- [ ] 无新增 typecheck 失败（特别是 plugin-swagger）
- [ ] 文件行数 ≤400（重点：拆分后 kernel.ts）
- [ ] commit message 格式：`fix: ... closes hygiene-XX`
