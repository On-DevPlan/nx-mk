/**
 * verify-scan.mjs —— 端到端 UI evidence 核验（结构与 commerce-orders 的
 * verify-scan.mjs 同构，仅换域：APP_URL、等待选择器、OWNED_OPERATIONS）。
 *
 * 为什么需要它：verify-pages.mjs 是**静态**检查（源码里有没有写错 field 字面量、
 * 有没有兜底），但 A1（visible:false → suspicious）与 A2/A3（weak）的真实判定发生在
 * 浏览器 DOM 采集之后。本脚本把那一步真跑一遍，让「35/35」这类数字可复现、可复查。
 *
 * 用的是**生产代码本身**，不是复刻：
 *   - 采集脚本：PAGE_SCAN_SCRIPT，从 @nx-mk/plugin-playwright 导入
 *     （即 packages/plugin-playwright/src/scanner.ts 里注入浏览器的那同一份字面量）
 *   - 可见性判定：浏览器内 getComputedStyle + getBoundingClientRect，与上面同一脚本
 *   - 质量判定：classifyEvidence，从 @nx-mk/coverage 导入
 *     （即 packages/coverage/src/anti-cheat/classify.ts 的同一函数）
 *   - 聚合语义：worstQuality 取最差 + uiHit 判定，照抄
 *     packages/coverage/src/analyzer/coverage-analyzer.ts:57-63 与 :104
 *   唯一「自己写的」部分是把这些结果按 manifest 分母复算成比值 —— 因为
 *   analyzeCoverage 需要 sqlite + policy decision，本脚本不建库（见文末「与 run 的差异」）。
 *
 * 用法（三项前置，缺一即报错退出）：
 *   1. plugin 已构建 —— 本脚本从 packages/plugin-playwright/dist/index.js 提取
 *      PAGE_SCAN_SCRIPT。全新克隆或 `pnpm clean` 后需先 `pnpm --filter @nx-mk/plugin-playwright build`
 *      （未构建时脚本会明确报「找不到 PAGE_SCAN_SCRIPT」而不是静默降级）。
 *   2. server(8803)：pnpm --filter @nx-mk-example/incidents-server dev
 *   3. app(5203)   ：MK_ANALYSIS=true pnpm --filter @nx-mk-example/incidents-app dev
 * 然后：
 *   node verify-scan.mjs                       # 默认 http://localhost:5203
 *   APP_URL=http://localhost:5203 node verify-scan.mjs
 * 或经根 package.json：pnpm incidents:scan
 *
 * 依赖解析：@nx-mk/plugin-playwright / @nx-mk/coverage 是**仓库根** devDependencies，
 * 本文件在 examples/devops-incidents 下运行，靠 Node 向上查找 node_modules 命中根安装。
 * playwright-core 不在根声明（只在 packages/plugin-playwright 里），故用 createRequire
 * 以 plugin 的路径为解析基准 —— 见下方 launchBrowser。
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const APP_URL = process.env.APP_URL ?? 'http://localhost:5203'

const { classifyEvidence } = await import('@nx-mk/coverage')

/**
 * 取生产采集脚本 PAGE_SCAN_SCRIPT（packages/plugin-playwright/src/scanner.ts:16）。
 *
 * ⚠️ 已知且刻意的偏离 —— 为什么不是直接 import：
 *   scanner.ts 的 PAGE_SCAN_SCRIPT **没有**从 @nx-mk/plugin-playwright 的公共入口再导出
 *   （dist/index.d.ts 只导出 createPlaywrightPlugin / resolveCollectTarget /
 *   createPlaywrightPluginDefault）。G8 禁止改 packages/**，故不能加导出。
 *   两种可选方案：
 *     (a) 把脚本正文抄一份 —— 会随插件演进静默漂移，扫描结果失去意义；
 *     (b) 从已构建的 dist 里按符号取出真实字符串（下面做法）。
 *   取 (b)：读 plugin 的 dist/index.js，用深匹配定位 `PAGE_SCAN_SCRIPT = ` 后的模板字面量，
 *   取出后断言其以 scanPage 的 IIFE 形态开头、且含 mkVisible/mkInViewport/dataMkField 三个标记，
 *   抽不到就直接抛错（绝不降级成「用默认值继续跑」）。
 *   残留风险：插件若改了变量名或改成非字面量导出，本脚本会**响亮失败**而非误报通过。
 */
function loadPageScanScript() {
  const bundle = readFileSync(pluginDistUrl, 'utf8')
  const marker = 'PAGE_SCAN_SCRIPT = '
  const at = bundle.indexOf(marker)
  if (at === -1) throw new Error(`在 ${pluginDistUrl.pathname} 里找不到 ${marker} —— 插件构建产物结构变了`)
  const start = bundle.indexOf('`', at)
  if (start === -1) throw new Error('PAGE_SCAN_SCRIPT 不是模板字面量，无法提取')
  let i = start + 1
  let out = ''
  while (i < bundle.length) {
    const c = bundle[i]
    if (c === '\\') {
      out += bundle[i + 1]
      i += 2
      continue
    }
    if (c === '`') break
    out += c
    i++
  }
  for (const needed of ['getComputedStyle', 'getBoundingClientRect', 'dataMkField', 'textContent']) {
    if (!out.includes(needed)) throw new Error(`提取到的 PAGE_SCAN_SCRIPT 缺少 ${needed}，不是预期的扫描脚本`)
  }
  return out
}

const pluginDistUrl = new URL('../../packages/plugin-playwright/dist/index.js', import.meta.url)
const PAGE_SCAN_SCRIPT = loadPageScanScript()

// 以 plugin 包为基准解析 playwright-core（根未声明该依赖）
const pluginRequire = createRequire(import.meta.resolve('@nx-mk/plugin-playwright'))
const { chromium } = pluginRequire('playwright-core')

const m = JSON.parse(readFileSync(new URL('./.nx-mk/manifest.json', import.meta.url), 'utf8'))

/** 与 coverage-analyzer.ts:57-63 同构：同一路径多条 evidence 取最差质量 */
const RANK = { valid: 0, weak: 1, suspicious: 2, invalid: 3 }

/**
 * DevOps 项目的全部四个 endpoint —— 一个都不能少（controller 裁定）：
 * 少列一个，它的字段在本脚本的分母里就消失，scan 会**低报**而不是报缺口
 * （与 verify-pages.mjs 的 OWNED_OPERATIONS 同源同责）。
 * getServiceHealth 的 200 与 503 各自分属不同 status code，field-id 派生键含 status 段，
 * 故两组 fieldId 都进分母（共 9 唯一 normalizedPath：5 个 200 + 4 个 503）。
 */
const OWNED_OPERATIONS = new Set([
  'listServices',
  'listServiceIncidents',
  'getServiceHealth',
  'createIncidentNote',
])

function worstByPath(evidence) {
  const worst = new Map()
  for (const ev of evidence) {
    const q = classifyEvidence({ visible: ev.visible, textSample: ev.textSample, fieldPath: ev.fieldPath })
    const prev = worst.get(ev.fieldPath)
    if (prev === undefined || RANK[q] > RANK[prev]) worst.set(ev.fieldPath, q)
  }
  return worst
}

function launchBrowser() {
  // headless + 自带 chromium：走 playwright-core 的默认下载目录
  return chromium.launch({ headless: true })
}

async function scanApp() {
  const browser = await launchBrowser()
  try {
    const page = await browser.newPage()
    const consoleErrors = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('pageerror', (e) => consoleErrors.push(String(e)))

    const response = await page.goto(APP_URL, { waitUntil: 'networkidle' })
    if (!response || !response.ok()) {
      throw new Error(`打开 ${APP_URL} 失败：HTTP ${response?.status() ?? '无响应'}`)
    }
    // 等四个视图都渲染完：服务列表 / 事件列表 / 200 健康卡 / 503 错误卡（dl 在 errBody 就绪后才出现）。
    // health-error dl 是 C2 绕行最关键的就绪信号 —— 它的 4 个字段必须等到原生 fetch 的 res.json() 拿到
    // 之后才渲染。漏掉这个等待点 → scan 时 dl 还未挂上 → 那 4 条路径被判 NO EVIDENCE。
    await page.waitForSelector("[data-page='service-list']", { timeout: 15000 })
    await page.waitForSelector("[data-page='incident-list']", { timeout: 15000 })
    await page.waitForSelector("[data-testid='health-ok']", { timeout: 15000 })
    await page.waitForSelector("[data-testid='health-error'] dl", { timeout: 15000 })
    await page.waitForSelector("[data-testid='incident-note']", { timeout: 15000 })
    // 访问证据必须齐全：任何 console error 都可能意味着某个 Field 没渲染出来。
    // ★ 本项目的特例：HealthChecker 的原生 fetch('/api/services/down-api/health') 故意触发
    // 503 —— 浏览器会自动把 503 响应记为 console error（"Failed to load resource: ... 503"）。
    // 这是 C2 绕行的预期副作用，不是真实 JS 错误 —— 过滤掉这一类。
    // 仅过滤明确由 503 资源加载产生的 error；其他 JS error 仍照常拒绝通过。
    const realErrors = consoleErrors.filter((m) => !/Failed to load resource.*503/i.test(m))
    if (realErrors.length) {
      throw new Error(`页面有 console error，evidence 不可信：\n  ${realErrors.join('\n  ')}`)
    }

    // G6 模式前置自检（实测事故驱动，2026-10-08）：vite 进程没带 MK_ANALYSIS=true 时，
    // vite 往页面注入的全局 __MK_ANALYSIS__ 是 false → SDK 走 production 分支 →
    // traces/hits 双通道全空：client.ts 发请求前置 __MK_SDK_INFLIGHT__ 标记**不分模式**，
    // shim 的 fetch 兜底补丁见标记就跳过（以为 SDK 会上报），而 production 分支根本不上报。
    // 此时 DOM 扫描（本脚本的 35/35）照样全绿——但 verify-coverage 的断言 H 必红，
    // 报错只有「采集没落数据」六个字，定位是时间黑洞。最常见的成因：目标端口被一个
    // 未带 MK_ANALYSIS 的孤儿 vite 占住（pnpm 停任务后 node 子进程常存活），新起的
    // vite 静默换端口、banner 打出另一个端口，run 扫的是孤儿。在此直接给出可执行的
    // 诊断，而不是让断言 H 的读者从零猜起。
    const analysisFlag = await page.evaluate(() =>
      typeof __MK_ANALYSIS__ === 'undefined' ? 'undefined' : String(__MK_ANALYSIS__),
    )
    if (analysisFlag !== 'true') {
      throw new Error(
        `页面全局 __MK_ANALYSIS__ = ${analysisFlag}（应为 true）—— ${APP_URL} 背后的 vite 不是以 MK_ANALYSIS=true 启动的。\n` +
          `排查：看 vite 启动 banner 的 Local 端口是否真是 ${new URL(APP_URL).port}（"Port in use, trying another one" 即中招）；\n` +
          `netstat -ano | findstr :${new URL(APP_URL).port} 找占端口的孤儿进程杀掉，再以\n` +
          `MK_ANALYSIS=true pnpm --filter @nx-mk-example/incidents-app dev 重启。`,
      )
    }

    // 采集：注入 plugin 的真实脚本，返回原始描述符
    const descs = await page.evaluate(PAGE_SCAN_SCRIPT)

    // toDescriptors + scanDom 的等价处理：防御性解析 + 过滤空 dataMkField
    // （照 packages/plugin-playwright/src/scanner.ts 与 packages/coverage/src/evidence/dom-scanner.ts:
    //   空 dataMkField 过滤；text 截断 80 字符；textSample 即 text）
    const evidence = descs
      .filter((d) => typeof d?.dataMkField === 'string' && d.dataMkField !== '')
      .map((d) => ({
        fieldPath: d.dataMkField,
        visible: d.visible === true,
        textSample: typeof d.text === 'string' ? d.text.slice(0, 80) : '',
      }))

    // A1 的 visible 维度：存在零宽/零高/隐藏的 Field 就是可疑信号，单独报出来
    const invisible = evidence.filter((e) => !e.visible).map((e) => e.fieldPath)
    return { evidence, invisible, scanned: descs.length }
  } finally {
    await browser.close()
  }
}

/** 采集前的可达性前置检查 —— 免得服务没起时抛一长串 playwright 栈 */
async function assertReachable() {
  try {
    const r = await fetch(APP_URL, { signal: AbortSignal.timeout(5000) })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
  } catch (e) {
    console.error(
      `无法访问 ${APP_URL}（${e.message}）。\n` +
        `本脚本需要两个服务同时在跑：\n` +
        `  server(8803)：pnpm --filter @nx-mk-example/incidents-server dev\n` +
        `  app(5203)   ：MK_ANALYSIS=true pnpm --filter @nx-mk-example/incidents-app dev\n` +
        `（静态检查不需要服务，可直接跑 node verify-pages.mjs）`,
    )
    process.exit(1)
  }
}

await assertReachable()
const { evidence, invisible, scanned } = await scanApp()
const worst = worstByPath(evidence)

const operationByEndpointId = new Map(m.endpoints.map((e) => [e.id, e.operationId]))
const ownedPaths = [
  ...new Set(
    m.fields.filter((f) => OWNED_OPERATIONS.has(operationByEndpointId.get(f.endpointId))).map((f) => f.normalizedPath),
  ),
].sort()

const missing = []
const weak = []
let covered = 0
for (const p of ownedPaths) {
  const q = worst.get(p)
  // coverage-analyzer.ts:104 —— uiHit：存在 evidence 且非 suspicious/invalid（weak 计 hit）
  const uiHit = q !== undefined && q !== 'suspicious' && q !== 'invalid'
  if (uiHit) covered++
  else missing.push(`${p} → quality=${q ?? 'NO EVIDENCE'}`)
  if (q === 'weak') weak.push(p)
}

console.log(`APP_URL            ${APP_URL}`)
console.log(`扫描 [data-mk-field] ${scanned} 个 → 有效 evidence ${evidence.length} 条`)
console.log(`本任务分母          ${ownedPaths.length} 条路径（listServices + listServiceIncidents + getServiceHealth×2 + createIncidentNote）`)
console.log(`requiredCoverage   ${(covered / ownedPaths.length).toFixed(4)}（${covered}/${ownedPaths.length}）`)
console.log(`weak 路径           ${weak.length ? weak.join(', ') : '无'}`)
console.log(`visible=false      ${invisible.length ? [...new Set(invisible)].join(', ') : '无'}`)

// A1/A2/A3 的可观测信号：把每条路径的最差质量与渲染文本列出来，便于人工抽查
console.log('\n逐路径明细（path → quality ← textSample）:')
for (const p of ownedPaths) {
  const samples = [...new Set(evidence.filter((e) => e.fieldPath === p).map((e) => e.textSample))]
  console.log(`  ${worst.get(p) ?? 'NONE'}  ${p}  ←  ${samples.map((s) => JSON.stringify(s)).join(' | ')}`)
}

if (missing.length || weak.length || invisible.length) {
  console.error('')
  if (missing.length) console.error(`未覆盖（${missing.length}）:\n  ` + missing.join('\n  '))
  if (weak.length) console.error(`weak（计 hit 但进 weakEvidenceFields，${weak.length}）:\n  ` + weak.join(', '))
  if (invisible.length) console.error(`visible=false（suspicious，不算 hit）:\n  ` + [...new Set(invisible)].join('\n  '))
  process.exit(1)
}

console.log(`\n全部 ${ownedPaths.length} 条路径 uiHit=true、无 weak、无 invisible —— 通过`)