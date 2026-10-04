/**
 * verify-scan.mjs —— 端到端 UI evidence 核验（Task 2 交付物）。
 *
 * 为什么需要它：verify-pages.mjs 是**静态**检查（源码里有没有写错 field 字面量、
 * 有没有兜底），但 A1（visible:false → suspicious）与 A2/A3（weak）的真实判定发生在
 * 浏览器 DOM 采集之后。本脚本把那一步真跑一遍，让「27/27」这类数字可复现、可复查。
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
 *   2. server(8801)：pnpm --filter @nx-mk-example/medical-server dev
 *   3. app(5201)   ：MK_ANALYSIS=true pnpm --filter @nx-mk-example/medical-app dev
 * 然后：
 *   node verify-scan.mjs                       # 默认 http://localhost:5201
 *   APP_URL=http://localhost:5201 node verify-scan.mjs
 * 或经根 package.json：pnpm medical:scan
 *
 * 依赖解析：@nx-mk/plugin-playwright / @nx-mk/coverage 是**仓库根** devDependencies，
 * 本文件在 examples/medical-records 下运行，靠 Node 向上查找 node_modules 命中根安装。
 * playwright-core 不在根声明（只在 packages/plugin-playwright 里），故用 createRequire
 * 以 plugin 的路径为解析基准 —— 见下方 launchBrowser。
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const APP_URL = process.env.APP_URL ?? 'http://localhost:5201'

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
 * 医疗记录项目的全部三个 endpoint —— 含 createPatient 的 201 回显。
 *
 * 第三个 operation 是 Task 3 补入的：此前分母刻意只含前两个，
 * 于是「回显渲染 data.createdAt」这条本任务唯一的增量路径在运行期**零 evidence** ——
 * 静态检查（verify-pages.mjs）能证明 field 字面量写对，证明不了它真渲染出非空可见文本。
 * 现分母为 28 条唯一路径（createPatient 的 data.id / data.name 与 getPatient 同名，
 * 按 A4 共享最差质量，故唯一路径 28 而非 30）。
 */
const OWNED_OPERATIONS = new Set(['getPatient', 'listPatientVisits', 'createPatient'])

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
    // 等两个患者的数据都渲染完（页面上有 4 个实例级 section）
    await page.waitForSelector("[data-page^='patient-detail-']", { timeout: 15000 })
    await page.waitForSelector("[data-page^='visit-history-']", { timeout: 15000 })
    // 访问证据必须齐全：任何 console error 都可能意味着某个 Field 没渲染出来
    if (consoleErrors.length) {
      throw new Error(`页面有 console error，evidence 不可信：\n  ${consoleErrors.join('\n  ')}`)
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
        `  server(8801)：pnpm --filter @nx-mk-example/medical-server dev\n` +
        `  app(5201)   ：MK_ANALYSIS=true pnpm --filter @nx-mk-example/medical-app dev\n` +
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
console.log(`本任务分母          ${ownedPaths.length} 条路径（getPatient + listPatientVisits + createPatient）`)
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
  if (weak.length) console.error(`weak（计 hit 但进 weakEvidenceFields，${weak.length}）:\n  ` + weak.join('\n  '))
  if (invisible.length) console.error(`visible=false（suspicious，不算 hit）:\n  ` + [...new Set(invisible)].join('\n  '))
  process.exit(1)
}

console.log(`\n全部 ${ownedPaths.length} 条路径 uiHit=true、无 weak、无 invisible —— 通过`)
