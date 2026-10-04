/**
 * 页面静态验证 —— 页面源码 ↔ manifest 的一致性出口。
 *
 * 四类机检，全部对应 runtime 的一条判定，但提前到静态期：
 *   1. 每个 field="..." 字面量必须存在于 manifest 的 normalizedPath 集合
 *      （P2 逐字不匹配 / P3 数组路径形态写错）
 *   2. 每个 Field 的 children 必须带兜底 —— 成员访问型表达式里出现 ?? / || / ?: 三者之一
 *      （A1/A2：null/空串渲染成空 span → visible:false → suspicious，或 textSample 空 → weak）
 *   3. 每个 Field 的 children 不得恰好等于字段路径的最后一段
 *      （A3：textSample === 末段 → weak，见 packages/coverage/src/anti-cheat/classify.ts:22）
 *   4. 自闭合 <Field /> 一律判错 —— 渲染空 span，必然 suspicious（A1）
 *
 * 外加反向断言：manifest 里 getPatient / listPatientVisits 的每个 normalizedPath
 * 都必须至少被某个 Field 渲染。正向只查「没写错」，反向查「没漏写」——
 * 漏写的字段要等 nx-mk run 跑完才暴露成 missing，这里提前拦。
 *
 * children 提取用手写括号配平而非正则：模板字符串 `${a.b}` 内含花括号，
 * 正则的 [^{}]* 会失配并错配到后面的 Field 上，产生假阴性。
 */
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const m = JSON.parse(readFileSync(new URL('./.nx-mk/manifest.json', import.meta.url), 'utf8'))
const paths = new Set(m.fields.map((f) => f.normalizedPath))

const PAGES = ['./app/src/PatientDetail.tsx', './app/src/VisitHistory.tsx']
const problems = []
const rendered = new Set()

/**
 * 剥掉注释 —— 扫描前必做。
 * 否则文档注释里提到的 field="..." 字面量会被当成渲染点，反向断言被顶替：
 * 删掉真正的 <Field> 仍能通过（已实测）。用 TypeScript 自己的 scanner，
 * 不用正则（正则分不清字符串里的 "//"）。
 */
function stripComments(src) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.JSX, src)
  let out = ''
  for (let k = scanner.scan(); k !== ts.SyntaxKind.EndOfFileToken; k = scanner.scan()) {
    const t = scanner.getToken()
    if (t === ts.SyntaxKind.SingleLineCommentTrivia || t === ts.SyntaxKind.MultiLineCommentTrivia) continue
    // 模板字符串原样保留（children 的插值表达式在里面），其余按原文透传
    out += src.slice(scanner.getTokenPos(), scanner.getTextPos())
  }
  return out
}

/** Field 开标签的 '>' 或自闭合 '/>' 之后，提取第一个 children。 */
function readChildren(src, from) {
  let i = from
  while (i < src.length) {
    const c = src[i]
    // 跳过属性值里的引号串（className="..."）
    if (c === '"' || c === "'") {
      const q = c
      i++
      while (i < src.length && src[i] !== q) i++
      i++
      continue
    }
    if (c === '/' && src[i + 1] === '>') return { kind: 'selfClosing' }
    if (c === '>') {
      i++
      break
    }
    i++
  }
  while (i < src.length && /\s/.test(src[i])) i++
  if (src[i] !== '{') {
    // 纯 JSX 文本 children，取到下一个 '<' 为止
    const end = src.indexOf('<', i)
    return { kind: 'text', text: src.slice(i, end === -1 ? i + 120 : end).trim() }
  }
  // 花括号配平；引号串（含模板字符串）整体跳过 —— ${...} 与其配平的 '}' 一并消费，
  // 不影响深度计数
  let depth = 0
  const start = i + 1
  for (; i < src.length; i++) {
    const c = src[i]
    if (c === '"' || c === "'" || c === '`') {
      const q = c
      i++
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') i++
        i++
      }
      continue
    }
    if (c === '{') depth++
    else if (c === '}' && --depth === 0) return { kind: 'expr', text: src.slice(start, i) }
  }
  return { kind: 'unterminated' }
}

for (const rel of PAGES) {
  let raw
  try {
    raw = readFileSync(new URL(rel, import.meta.url), 'utf8')
  } catch {
    problems.push(`${rel}: 文件不存在 —— 先写页面再跑本脚本`)
    continue
  }
  const src = stripComments(raw)
  for (const match of src.matchAll(/field="([^"]+)"/g)) {
    const field = match[1]
    rendered.add(field)
    const at = `${rel}: field="${field}"`
    if (!paths.has(field)) problems.push(`${at} 不在 manifest 的 normalizedPath 集合中`)

    const child = readChildren(src, match.index + match[0].length)
    if (child.kind === 'selfClosing') {
      problems.push(`${at} 是自闭合 <Field />，渲染空 span → visible:false → suspicious（A1）`)
      continue
    }
    if (child.kind === 'unterminated') {
      problems.push(`${at} 的 children 花括号未配平，脚本无法判定`)
      continue
    }

    const text = child.text.trim()
    const leaf = field.split('.').pop() ?? field
    // A3：children 恰为字段名末段 → classifyEvidence 判 weak
    if (text === leaf) {
      problems.push(`${at} 的 children 恰为字段名末段 "${leaf}" → 会被 classifyEvidence 判 weak（A3）`)
    }
    // A1/A2：成员访问型表达式必须带兜底算子（?? / || / ?: 三者语义等价，都能在空值时产出可见文本）
    if (child.kind === 'expr' && text.includes('.') && !/(\?\?|\|\||\?)/.test(text)) {
      problems.push(`${at} 的 children 是裸成员访问 {${text}}，可能为空 → 需 ?? / || / 三元兜底（A1/A2）`)
    }
  }
}

// 反向断言：范围 = 本任务两个 endpoint。fields[].endpointId → endpoints[].id → operationId
// （operationId 只挂在 endpoint 上，不在 field 上）。
// Task 3 的 POST 201 回显（createPatient）不在本任务范围，其 data.createdAt 由 NewPatientForm 渲染。
const OWNED_OPERATIONS = new Set(['getPatient', 'listPatientVisits'])
const operationByEndpointId = new Map(m.endpoints.map((e) => [e.id, e.operationId]))
const ownedPaths = new Set(
  m.fields
    .filter((f) => OWNED_OPERATIONS.has(operationByEndpointId.get(f.endpointId)))
    .map((f) => f.normalizedPath),
)
if (ownedPaths.size === 0) {
  problems.push('manifest.fields 上没有可用的 endpointId，无法按 endpoint 划出本任务范围')
} else {
  const missing = [...ownedPaths].filter((p) => !rendered.has(p)).sort()
  if (missing.length) {
    problems.push(
      `以下 manifest 字段在本任务的两个页面里都没有 Field → 运行时必为 missing（${missing.length}/${ownedPaths.size}）：\n    ` +
        missing.join('\n    '),
    )
  }
}

if (problems.length) {
  console.error('页面静态验证失败:\n  ' + problems.join('\n  '))
  process.exit(1)
}
console.log(
  `[verify-pages] 页面 Field 字面量全部合法（${PAGES.length} 个文件，` +
    `渲染 ${rendered.size} 个唯一路径，本任务分母 ${ownedPaths.size} 个全命中）`,
)