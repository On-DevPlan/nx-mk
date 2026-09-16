/**
 * SDK-CG3 migrate codemod —— fetch('/api/...') → api.ns.method({...}) 静态替换
 *
 * 纯函数核心（spec §3.4）：输入文件内容数组，输出替换后内容与报告；文件 IO 由调用方
 * （CLI）完成。匹配规则：
 *   1. fetch CallExpression，首参 StringLiteral / NoSubstitutionTemplateLiteral
 *   2. 值以 apiPrefix + '/' 开头（否则 outside api prefix）
 *   3. 含 '?' → query in url；模板字符串带插值 → dynamic url
 *   4. 第二参缺省 → GET；ObjectLiteral 仅含 method 字面量 → 采用；否则 request init not supported
 *   5. 剥前缀后按段与 endpoint path 模板匹配（段数相等、字面段相等、{param} 捕获）
 *   6. 替换为 api.ns.method() / api.ns.method({ id: "v" })；ns/method 走 codegen 同源 derive
 *   7. 有替换且缺 import → 插入 `import { api } from '<importSpecifier>'`（按 specifier 去重）
 */

import ts from 'typescript'
import type { ApiEndpoint, ApiManifest } from '@nx-mk/manifest-schema'
import { deriveMethodName, deriveNamespace } from '../codegen/emit-endpoint.js'

export interface MigrateCodemodInput {
  manifest: ApiManifest
  files: { path: string; content: string }[]
  apiPrefix?: string
  importSpecifier?: string
}

export interface MigrateReport {
  replaced: { path: string; from: string; to: string }[]
  skipped: { path: string; fetch: string; reason: string }[]
}

export interface MigrateCodemodResult {
  files: { path: string; content: string; changed: boolean }[]
  report: MigrateReport
}

interface Edit {
  start: number
  end: number
  text: string
}

interface EndpointIndexEntry {
  endpoint: ApiEndpoint
  namespace: string
  methodName: string
  segments: string[] // path 模板按 '/' 切段，'{id}' 表示参数段
}

export function migrateCodemod(input: MigrateCodemodInput): MigrateCodemodResult {
  const apiPrefix = input.apiPrefix ?? '/api'
  const importSpecifier = input.importSpecifier ?? './generated-sdk'
  const index = buildEndpointIndex(input.manifest.endpoints)
  const report: MigrateReport = { replaced: [], skipped: [] }

  const files = input.files.map((file) => {
    const edits = collectEdits(file, { apiPrefix, index, report })
    if (edits.length === 0) return { ...file, changed: false }

    const source = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true)
    if (!hasApiImport(source, importSpecifier)) {
      edits.push(importInsertEdit(source, importSpecifier))
    }
    return { path: file.path, content: applyEdits(file.content, edits), changed: true }
  })

  return { files, report }
}

// ─── endpoint 索引：method → 候选模板段 ─────────────────────────────────────

function buildEndpointIndex(endpoints: ApiEndpoint[]): Map<string, EndpointIndexEntry[]> {
  const map = new Map<string, EndpointIndexEntry[]>()
  for (const endpoint of endpoints) {
    const lastSeg = endpoint.path.split('/').filter((s) => s && !s.startsWith('{')).pop() ?? 'root'
    const entry: EndpointIndexEntry = {
      endpoint,
      namespace: deriveNamespace(endpoint),
      methodName: deriveMethodName(endpoint, lastSeg),
      segments: endpoint.path.split('/').filter(Boolean),
    }
    const list = map.get(endpoint.method) ?? []
    list.push(entry)
    map.set(endpoint.method, list)
  }
  return map
}

// ─── 单文件扫描：产出 Edit 列表（含替换与报告） ─────────────────────────────

interface ScanContext {
  apiPrefix: string
  index: Map<string, EndpointIndexEntry[]>
  report: MigrateReport
}

function collectEdits(
  file: { path: string; content: string },
  ctx: ScanContext,
): Edit[] {
  const source = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true)
  const edits: Edit[] = []

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'fetch') {
      handleFetchCall(node, file.path, source, ctx, edits)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return edits
}

function handleFetchCall(
  call: ts.CallExpression,
  path: string,
  source: ts.SourceFile,
  ctx: ScanContext,
  edits: Edit[],
): void {
  const fetchText = call.getText(source)
  const skip = (reason: string): void => {
    ctx.report.skipped.push({ path, fetch: fetchText, reason })
  }

  // 规则 1：首参必须是静态字符串字面量
  const first = call.arguments[0]
  if (!first || !(ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) {
    skip('dynamic url')
    return
  }
  const url = first.text

  // 规则 2：apiPrefix + '/' 前缀
  if (!url.startsWith(`${ctx.apiPrefix}/`)) {
    skip('outside api prefix')
    return
  }
  const rest = url.slice(ctx.apiPrefix.length)

  // 规则 3：query / 动态段
  if (rest.includes('?')) {
    skip('query in url')
    return
  }

  // 规则 4：第二参 —— 缺省 GET；仅 method 字面量可用
  let method = 'GET'
  const second = call.arguments[1]
  if (second !== undefined) {
    if (!ts.isObjectLiteralExpression(second)) {
      skip('request init not supported')
      return
    }
    const props = second.properties
    const nonMethod = props.filter(
      (p) => !(ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'method'),
    )
    if (nonMethod.length > 0) {
      skip('request init not supported')
      return
    }
    const methodProp = props.find(
      (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'method',
    )
    if (methodProp) {
      const init = methodProp.initializer
      if (!ts.isStringLiteral(init)) {
        skip('request init not supported')
        return
      }
      method = init.text.toUpperCase()
    }
  }

  // 规则 5：段匹配（第一个命中的 endpoint 获胜）
  const segs = rest.split('/').filter(Boolean)
  let matched: { entry: EndpointIndexEntry; params: Record<string, string> } | undefined
  for (const entry of ctx.index.get(method) ?? []) {
    if (entry.segments.length !== segs.length) continue
    const params: Record<string, string> = {}
    let ok = true
    for (let i = 0; i < segs.length; i++) {
      const tpl = entry.segments[i]!
      if (tpl.startsWith('{') && tpl.endsWith('}')) {
        params[tpl.slice(1, -1)] = segs[i]!
      } else if (tpl !== segs[i]) {
        ok = false
        break
      }
    }
    if (ok) {
      matched = { entry, params }
      break
    }
  }
  if (!matched) {
    skip('no endpoint match')
    return
  }

  // 规则 6：构造替换文本
  const argEntries = Object.entries(matched.params)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join(', ')
  const to =
    argEntries.length > 0
      ? `api.${matched.entry.namespace}.${matched.entry.methodName}({ ${argEntries} })`
      : `api.${matched.entry.namespace}.${matched.entry.methodName}()`
  edits.push({ start: call.getStart(source), end: call.getEnd(), text: to })
  ctx.report.replaced.push({ path, from: fetchText, to })
}

// ─── import 检测与插入 ──────────────────────────────────────────────────────

function hasApiImport(source: ts.SourceFile, specifier: string): boolean {
  return source.statements.some(
    (st) => ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.moduleSpecifier.text === specifier,
  )
}

function importInsertEdit(source: ts.SourceFile, specifier: string): Edit {
  const stmt = `import { api } from '${specifier}'`
  const imports = source.statements.filter((st) => ts.isImportDeclaration(st))
  if (imports.length > 0) {
    const last = imports[imports.length - 1]!
    return { start: last.getEnd(), end: last.getEnd(), text: `\n${stmt}` }
  }
  // 无 import：插到首条语句前（保留其前导注释/空白）
  const first = source.statements[0]
  const pos = first ? first.getStart(source) : 0
  return { start: pos, end: pos, text: `${stmt}\n` }
}

function applyEdits(content: string, edits: Edit[]): string {
  // 从后往前应用，避免前面的插入使后面偏移失效
  const sorted = [...edits].sort((a, b) => b.start - a.start)
  let out = content
  for (const e of sorted) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end)
  }
  return out
}
