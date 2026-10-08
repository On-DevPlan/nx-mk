/**
 * verify-coverage.mjs —— 真 100% 验收门（计划 Global Constraints「验收断言 A–H」；
 * 实现与 commerce-orders 的 verify-coverage.mjs 同构，含 review Critical 修复的断言 A-0）。
 *
 * 为什么需要它：verify-pages.mjs 是**静态**检查（源码里 field 字面量有没有写错、
 * 有没有 DASH 兜底），verify-scan.mjs 是**旁路**复算（自建浏览器 + 生产 classifyEvidence
 * 重算一遍比值，但不落任何产物）。100% 这个数真正的账本只有一处 ——
 * `nx-mk run` 落盘的 `.nx-mk/coverage-report.json` 与 `.nx-mk/coverage.db`。
 * 本脚本只读这两处产物做断言，不重跑采集、不自己算比值：
 * 任何「页面看着都渲染了」的自证都不算数，只有 run 的产物算数。
 *
 * 三处产物各管一段，缺一即不可验：
 *   coverage-report.json → 断言 B/C/D/E（analyzer 的判定口径）
 *   coverage.db          → 断言 A（Goal Loop 终止原因）+ A-0（报告非陈旧）+ H（三表非空）
 *   runs/<runId>/events.jsonl → 断言 G（场景执行结果）
 *
 * ⚠️ 断言 G 的实现勘误（实现期读码发现，与计划原文不同 —— 别照计划抄）：
 *   计划原文断言「读 scenarios.json」。**该文件不存在**。实测 plugin-playwright
 *   只把场景结果 emit 成事件流：packages/plugin-playwright/src/index.ts:298
 *   `ctx.events.emit({ type:'scenario:done', scenarioId, ok, timestamp })`，
 *   由 kernel 落盘到 `.nx-mk/runs/<runId>/events.jsonl`（packages/kernel/src/kernel.ts:48）。
 *   而且**场景失败不影响进程退出码**（同文件 :299-302 只 logger.warn，不抛），
 *   所以「run 退出码 0」不能代表场景全过 —— 断言 A 的 exit code 那一半与断言 G
 *   是两个独立事实，必须分别查。
 *
 * ⚠️ 断言 A-0（review Critical，本脚本最关键的一条）：**先验报告不是陈旧的**。
 *   coverage-report.json 只在成功路径写（run.ts:192 在 try 内）；失败路径
 *   （run.ts:222-228）只把 runs 行标 failed 后 rethrow，**从不碰报告文件**。
 *   若直接按 report.runId 收窄其余断言，收窄键本身就来自那个幸存文件 ——
 *   采集崩了之后八条断言会读上一次的成功报告全绿。见下方「断言 A-0」处的注释。
 *
 * 用法（必须先跑采集，否则报「缺产物」而非静默通过）：
 *   1. server(8803)：pnpm --filter @nx-mk-example/incidents-server dev
 *   2. app(5203)   ：MK_ANALYSIS=true pnpm --filter @nx-mk-example/incidents-app dev
 *   3. 采集        ：cd examples/devops-incidents && node ../../packages/cli/dist/index.js run
 *   4. 验收        ：node verify-coverage.mjs
 *
 * 依赖解析：better-sqlite3 与 yaml 都不在本项目的依赖树里（pnpm 虚拟 store 只对声明方可见），
 * 故 createRequire 锚到确实声明了它们的仓库内工作区包上 —— 详见下方 coverageRequire 处的注释。
 *
 * 本脚本只读，不写任何产物。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

/** 项目根目录（本文件所在目录）—— Windows 下 URL.pathname 是 /D:/… 形态，故走 fileURLToPath */
const root = fileURLToPath(new URL('./', import.meta.url))

/** 逐条收集失败，最后一次性报 —— 不在第一处失败就退出，让人一次看全所有未过的门 */
const failures = []
/** 未能验证的断言（环境缺失等）—— 与失败分开报，绝不混进「全过」 */
const unverifiable = []
const ok = (cond, msg) => { if (!cond) failures.push(msg) }
/** 依赖装不上时登记为「未验证」而非「失败」—— 两者语义不同，见文末退出码 */
const skip = (msg) => { unverifiable.push(msg) }

/**
 * 只认**本次 run** 的行。
 * coverage.db 是累积的（field_hits / ui_evidence 用 `INSERT OR REPLACE` + run_id 前缀，
 * 跨 run 累积），所以 `SELECT COUNT(*) FROM field_hits` 非空**不能**证明本次采集落了数据 ——
 * 那是上一次成功 run 的残留。必须按 coverage-report.json 的 runId 收窄，
 * 否则「三表非空」这条断言在一次失败 run 之后也会照样通过（假绿）。
 */
const reportPath = join(root, '.nx-mk', 'coverage-report.json')
let runId = null
/** 报告全文；仅在文件存在时为 null 之前的分支赋值 —— 收口打印时复用，不再重读 */
let report = null

/**
 * 依赖解析的锚点。
 * better-sqlite3 与 yaml 都不在**本项目**的依赖里（pnpm 虚拟 store 只对声明方可见），
 * 故分别锚到确实声明了它们的仓库内工作区包上：
 *   better-sqlite3 → packages/coverage 的 dependencies
 *   yaml           → packages/config    的 dependencies
 * 为什么必须锚：`import.meta.resolve('@nx-mk/coverage')` 本身**能**解析成功（根
 * devDependencies 里有它），但裸 `require('better-sqlite3')` 从本目录会 MISSING ——
 * 缺的不是包，是 pnpm 虚拟 store 的可见性：better-sqlite3 只被 packages/coverage
 * 声明，故只对该包（及 monorepo 根）的解析基准可见。createRequire 以目标包的
 * 真实路径为基准，正好落进那个可见范围。yaml 同理（只被 packages/config 声明）。
 * 用 import() 而非 createRequire 则不行：动态 import 的解析基准恒是**本文件**。
 * 锚点写成仓库内相对路径，不依赖安装布局的偶然性。
 * 任一锚点失效（包未构建 / 依赖被移除）时抛 —— 落到 skip，不静默降级成「跳过这些断言也算过」。
 */
const coverageRequire = createRequire(import.meta.resolve('@nx-mk/coverage'))
const configRequire = createRequire(new URL('../../packages/config/dist/index.js', import.meta.url))

// ───────────────────────────────────────────────────────────────────────
// 断言 B / C / D / E —— coverage-report.json
// ───────────────────────────────────────────────────────────────────────
if (!existsSync(reportPath)) {
  skip(`断言 B/C/D/E: 缺 ${reportPath} —— 先跑 nx-mk run`)
} else {
  report = JSON.parse(readFileSync(reportPath, 'utf8'))
  runId = typeof report.runId === 'string' ? report.runId : null
  const m = report.metrics ?? {}
  ok(m.requiredCoverage === 1, `断言 B: requiredCoverage=${m.requiredCoverage}（应为 1）`)
  ok(m.missingRequiredFields === 0, `断言 C: missingRequiredFields=${m.missingRequiredFields}（应为 0）`)

  const suspicious = report.suspiciousCoverage ?? []
  ok(
    m.suspiciousFields === 0 && suspicious.length === 0,
    `断言 D: suspiciousFields=${m.suspiciousFields}（应为 0），明细 ${suspicious.length} 条` +
      (suspicious.length ? ':\n' + suspicious.slice(0, 10).map((s) => `      ${s.fieldPath}`).join('\n') : ''),
  )

  const weak = report.weakEvidenceFields ?? []
  ok(
    weak.length === 0,
    `断言 E: weakEvidenceFields 非空（${weak.length} 条）—— A2 空文本 / A3 值等于字段名末段:\n` +
      weak.slice(0, 10).map((w) => `      ${w.fieldPath}`).join('\n'),
  )

  const missing = report.missingRequiredFields ?? []
  if (missing.length) {
    console.error('缺失字段清单（P4 盲区的定位入口）:\n' + missing.map((f) => `  - ${f.fieldPath}`).join('\n'))
  }
}

// ───────────────────────────────────────────────────────────────────────
// 断言 A / A-0 / H —— coverage.db
// ───────────────────────────────────────────────────────────────────────
const dbPath = join(root, '.nx-mk', 'coverage.db')
if (!existsSync(dbPath)) {
  skip(`断言 A/A-0/H: 缺 ${dbPath} —— 先跑 nx-mk run`)
} else {
  let Database = null
  try {
    Database = coverageRequire('better-sqlite3')
  } catch (err) {
    skip(`断言 A/A-0/H: better-sqlite3 不可用（${err.message.split('\n')[0]}）—— 无法直查 coverage.db`)
  }

  if (Database) {
    const db = new Database(dbPath, { readonly: true })
    try {
      // ── 断言 A-0（防「陈旧报告」——本脚本最关键的一条）──
      // coverage-report.json **只在成功路径写**（run.ts:192 在 try 内），失败路径
      // （run.ts:222-228）只把 runs 行标 failed 后 rethrow，**从不碰报告文件**。
      // 于是：采集崩了 → 上一次的报告仍在磁盘上 → 八条断言全部读它 → 全绿。
      // 这不是罕见窗口，medical-records 自己的 PLUGIN_HOOK_FAILED(ENOENT) 就是这个
      // 形状：run 早死、报告幸存。本项目冷启动第一次 run（服务未起）也会留下这个
      // 形状 —— incidents:codegen 的 `(run || test -f manifest)` 门正是为此。
      //
      // 故先验「报告是不是在描述最新一次 run」。写入 runs 行的有两个入口：
      //   run.ts:104-105（run，成功必写报告）与 agent/src/runtime.ts:129（agent-loop，
      //   由 `nx-mk loop` 触发，不写 coverage-report.json）。
      // 故「最新行 ≠ 报告 runId」有两种成因，都判失败：最新那次 run 没产出报告，
      // 或最新那次是 agent-loop（它本就不写报告，此时应当重跑 run 让报告追上）。
      // 两种成因的补救动作相同，故合并为一条断言，不区分。
      // 两种子情形都判失败：
      //   (a) 最新行更新的 failed 行：报告是上一次成功 run 的陈旧文件；
      //   (b) 最新行更新的 completed 行但报告没跟上：报告写失败（run.ts:190-195 的
      //       try 只 warn 不阻断），同样无法证明任何东西。
      // 附带把 runId 收窄键本身也钉住：matched 取不到行（报告指向的 run 不存在）
      // 同样落到下面的 status 断言失败，不静默跳过。
      const newest = db
        .prepare('SELECT id, started_at, status, terminated_by FROM runs ORDER BY started_at DESC, id DESC LIMIT 1')
        .get()
      if (runId === null) {
        skip('断言 A: coverage-report.json 无 runId —— 无法把 runs 行与报告对上')
      } else if (newest === undefined) {
        skip('断言 A: runs 表为空 —— 无法判断报告是否描述最新一次 run')
      } else {
        ok(
          newest.id === runId,
          `断言 A-0: runs 表最新行是 ${newest.id}（${newest.status}，started_at=${newest.started_at}），` +
            `但报告描述的是 ${runId} —— 报告已陈旧，不能证明最新一次 run（先重跑 nx-mk run）`,
        )

        // —— 断言 A：Goal Loop 以 goal-met 终止（非 max-turns / idle / timeout）——
        // 这才是「100% 是达成后停的」而非「跑满轮次碰巧停了」的证据。
        // 同时校验 status='completed'：terminated_by 与 status 是两个独立列，
        // 失败收尾路径只写 status='failed'、terminated_by 留 NULL。
        const matched = db.prepare('SELECT id, status, terminated_by FROM runs WHERE id = ?').get(runId)
        ok(
          matched?.terminated_by === 'goal-met',
          `断言 A: run ${runId} 的 terminated_by=${matched?.terminated_by ?? 'NULL'}（应为 goal-met）`,
        )
        ok(matched?.status === 'completed', `断言 A: run ${runId} 的 status=${matched?.status}（应为 completed）`)
      }

      // —— 断言 H：本次 run 的三表均非空 ——
      // 按 run_id 收窄（见上方 runId 注释）：不分 run 的话断言会在失败 run 之后假绿。
      if (runId === null) {
        skip('断言 H: 无 runId 可收窄 —— 无法按本次 run 统计三表（宁可不验，也不查全表）')
      } else {
        for (const t of ['field_hits', 'ui_evidence', 'request_traces']) {
          const row = db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE run_id = ?`).get(runId)
          ok(row.n > 0, `断言 H: ${t} 在本次 run（${runId}）内为空 —— 采集没落数据`)
        }
      }
    } finally {
      db.close()
    }
  }
}

// ───────────────────────────────────────────────────────────────────────
// 断言 G —— 场景执行结果（events.jsonl 的 scenario:done 事件）
// ───────────────────────────────────────────────────────────────────────
const runsDir = join(root, '.nx-mk', 'runs')
if (!existsSync(runsDir)) {
  skip(`断言 G: 缺 ${runsDir} —— 先跑 nx-mk run`)
} else {
  // 只看本次 run 的 events.jsonl；retainRuns=5 会留旧 run 目录，
  // 扫全部目录会把上一次失败的场景也算进来（或反过来掩盖本次失败）。
  const eventsPath = join(runsDir, runId ?? '', 'events.jsonl')
  if (!existsSync(eventsPath)) {
    skip(`断言 G: 缺 ${eventsPath} —— 场景套件未执行（检查 config 的 scenarios.include 与 yml glob）`)
  } else {
    const done = []
    for (const line of readFileSync(eventsPath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim()
      if (trimmed === '') continue
      let ev
      try {
        ev = JSON.parse(trimmed)
      } catch {
        continue // 损坏行跳过（与 dashboard 的 pipeline-reader 同口径）
      }
      if (ev?.type === 'scenario:done') done.push(ev)
    }
    ok(done.length > 0, `断言 G: ${eventsPath} 内无 scenario:done 事件 —— 场景套件未执行`)
    const failed = done.filter((e) => e.ok !== true).map((e) => `${e.scenarioId} (ok=${e.ok})`)
    ok(failed.length === 0, `断言 G: 场景失败 ${failed.length}/${done.length}: ${failed.join(', ')}`)
    if (done.length > 0) {
      console.log(`[verify] 场景结果: ${done.map((e) => `${e.scenarioId}=${e.ok ? 'pass' : 'FAIL'}`).join(', ')}`)
    }
  }
}

// ───────────────────────────────────────────────────────────────────────
// 断言 F —— config 的 coverage.ignored 为空（G1：不得靠 ignored 缩小分母）
// ───────────────────────────────────────────────────────────────────────
// 用真实 YAML 解析而非正则：正则对 `ignored: []` / `ignored:\n  - foo` / 行内注释
// 三种写法都要分支处理，写对了也是「正则碰巧没匹配到」而非「解析出空数组」。
try {
  const { parse } = configRequire('yaml')
  const cfg = parse(readFileSync(join(root, 'nx-mk.config.yml'), 'utf8'))
  const configIgnored = cfg?.coverage?.ignored
  ok(
    Array.isArray(configIgnored) && configIgnored.length === 0,
    `断言 F: coverage.ignored 非空 —— ${JSON.stringify(configIgnored ?? null)}（G1：真 100% 不许靠 ignored 缩小分母）`,
  )
} catch (err) {
  skip(`断言 F: 无法解析 nx-mk.config.yml（${err.message.split('\n')[0]}）`)
}

// ───────────────────────────────────────────────────────────────────────
// 静态断言（Review Focus #5/#6）—— 场景是 coverage 的子集，不能替代 B/C
// ───────────────────────────────────────────────────────────────────────
const scenarioDir = join(root, 'mk', 'scenarios')
if (!existsSync(scenarioDir)) {
  skip(`静态断言 S4: 缺 ${scenarioDir}`)
} else {
  const files = readdirSync(scenarioDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  ok(files.length > 0, `静态断言 S4: ${scenarioDir} 下无 .yml 场景文件`)

  // S4：整页导航重置 collector 缓冲，故每个场景文件只许一个 goto
  for (const f of files) {
    const gotoCount = (readFileSync(join(scenarioDir, f), 'utf8').match(/type:\s*goto/g) ?? []).length
    ok(gotoCount === 1, `静态断言 S4: ${f} 含 ${gotoCount} 个 goto（应为 1）`)
  }

  // S5：DSL schema 的 steps 上限是 50（packages/scenario/src/dsl-schema.ts）
  try {
    const { parse } = configRequire('yaml')
    for (const f of files) {
      const doc = parse(readFileSync(join(scenarioDir, f), 'utf8'))
      for (const sc of doc?.scenarios ?? []) {
        const n = Array.isArray(sc?.steps) ? sc.steps.length : 0
        ok(n >= 1 && n <= 50, `静态断言 S5: ${f} 的场景 ${sc?.id} 有 ${n} 步（应在 1..50）`)
      }
    }
  } catch (err) {
    skip(`静态断言 S5: 无法解析场景文件（${err.message.split('\n')[0]}）`)
  }
}

// ───────────────────────────────────────────────────────────────────────
// 收口
// ───────────────────────────────────────────────────────────────────────
// 退出码 2 = 门开不了（关键依赖缺失 / 产物不存在），与「断言失败」区分开。
// 仓库 CI/父脚本能据此判断「需要先跑采集」而不是「验收没过」。
if (failures.length || unverifiable.length) {
  if (failures.length) {
    console.error('\n验收失败:\n' + failures.map((f) => `  ✗ ${f}`).join('\n'))
  }
  if (unverifiable.length) {
    console.error('\n未能验证（缺前置产物/依赖，**不等于通过**）:\n' + unverifiable.map((u) => `  ? ${u}`).join('\n'))
  }
  process.exit(failures.length > 0 ? 1 : 2)
}

// 走到这里意味着 failures 与 unverifiable 皆空 —— 即报告存在（否则 B/C/D/E 会 skip），
// 故直接复用上面那份 report，不再重读一次文件。
console.log(`[verify-coverage] 断言 A–H 全过 —— requiredCoverage=${report.metrics.requiredCoverage} (100%) ✅`)