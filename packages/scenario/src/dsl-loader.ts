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
import { RequestDeclFileSchema, type RequestDecl } from './request-dsl.js'

/** 路径段 glob → RegExp：`**` 跨段（后随分隔符时允许零段，即直连同目录文件）、`*` 单段、其余字符转义 */
export function globToRegExp(pattern: string): RegExp {
  let out = ''
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          out += '(?:.*[/\\\\])?' // **/ 匹配零或多段（零段 = 直连同目录文件）
          i += 2 // 吞掉第二个 * 与其后的 /
        } else {
          out += '.*'
          i++ // 吞掉第二个 *
        }
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
  for (const name of readdirSync(baseDir).sort()) {
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
    // collectFiles 以「相对枚举根」的路径做匹配，正则须剔除字面前缀
    const re = globToRegExp(globIdx === -1 ? pattern : pattern.slice(rootRel.length))
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

export interface LoadedRequest {
  request: RequestDecl
  file: string
}

export interface LoadRequestsResult {
  requests: LoadedRequest[]
  skipped: string[]
}

/**
 * 加载 requests: 声明（C9 §26.2）。
 * 与 loadScenarios 同 glob 语义但独立解析：单个文件若是 RequestDeclFileSchema
 * （顶层 requests:）则整体消费；若是 ScenarioFileSchema（顶层 scenarios:）则取
 * 其可选 requests 段。两类文件可共存于 include 模式（同 id 去重首个胜出）。
 */
export function loadRequests(cwd: string, include: ReadonlyArray<string>): LoadRequestsResult {
  const requests: LoadedRequest[] = []
  const skipped: string[] = []
  const seenIds = new Set<string>()
  for (const pattern of include) {
    const globIdx = pattern.search(/[*]/)
    const rootRel = globIdx === -1 ? pattern : pattern.slice(0, pattern.lastIndexOf('/', globIdx) + 1) || ''
    const re = globToRegExp(globIdx === -1 ? pattern : pattern.slice(rootRel.length))
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
      // 先试纯 requests 文件；再试混合文件（scenarios: 带 requests? 段）
      let declared: RequestDecl[] | undefined
      const requestGate = RequestDeclFileSchema.safeParse(parsed)
      if (requestGate.success) {
        declared = requestGate.data.requests
      } else {
        const mixed = ScenarioFileSchema.safeParse(parsed)
        if (mixed.success && mixed.data.requests !== undefined) {
          declared = mixed.data.requests
        }
      }
      if (declared === undefined) {
        skipped.push(`${file}: no requests: section`)
        continue
      }
      for (const r of declared) {
        if (seenIds.has(r.id)) {
          skipped.push(`${file}: duplicate request id '${r.id}' (first wins)`)
          continue
        }
        seenIds.add(r.id)
        requests.push({ request: r, file })
      }
    }
  }
  return { requests, skipped }
}
