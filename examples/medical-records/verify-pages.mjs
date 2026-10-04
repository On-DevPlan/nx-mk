/**
 * 页面静态验证 —— 页面源码 ↔ manifest 的一致性出口。
 *
 * 四类机检，全部对应 runtime 的一条判定，但提前到静态期：
 *   1. 每个 field="..." 字面量必须存在于 manifest 的 normalizedPath 集合
 *      （P2 逐字不匹配 / P3 数组路径形态写错）
 *   2. 每个 Field 的 children 必须自带兜底 —— AST 上存在真正的 ?? / || / 三元
 *      （A1/A2：null/空串渲染成空 span → visible:false → suspicious，或 textSample 空 → weak）。
 *      刻意排除 `?.`：a?.b 在 a=null 时求值为 undefined，渲染不出内容，正是 A1 的靶心。
 *   3. 每个 Field 的 children 不得恰好等于字段路径的最后一段
 *      （A3：textSample === 末段 → weak，见 packages/coverage/src/anti-cheat/classify.ts:22）
 *   4. 自闭合 <Field /> 一律判错 —— 渲染空 span，必然 suspicious（A1）
 *
 * 外加反向断言：manifest 里 getPatient / listPatientVisits 的每个 normalizedPath
 * 都必须至少被某个 Field 渲染。正向只查「没写错」，反向查「没漏写」——
 * 漏写的字段要等 nx-mk run 跑完才暴露成 missing，这里提前拦。
 *
 * children 判定走 TypeScript AST（createSourceFile + 遍历），不靠正则 ——
 * 正则版曾有三处假阴性：`?.` 被误当兜底、`{"name"}` 引号未解、空模板字面量被跳过。
 * 详见 inspectFields 的注释。
 */
import { readFileSync } from 'node:fs'
// typescript 解析路径：本文件在 examples/medical-records/ 下，该目录没有自己的
// package.json（pnpm workspace 的 examples/** 只匹配到 app/ 与 server/ 两个包），
// 故 Node 逐级向上命中**仓库根** node_modules —— 根 devDependencies 已声明
// "typescript": "^5.3.3"，app 工作区也声明了一份，两处皆已显式，非隐式依赖。
// 实际解析到 node_modules/.pnpm/typescript@5.9.3/...（pnpm 提升后的版本）。
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

/**
 * 找出页面里所有 <Field field="..."> 的 children 形态，用 TypeScript AST 而非正则。
 *
 * 为什么不用正则（前三版都栽在这）：
 *   - `?.` 会被「兜底算子」正则里的裸 `?` 命中 —— 但 `a?.b` 在 a=null 时求值为
 *     undefined，React 渲染不出任何东西，正是 A1 要防的空 span（Finding 3）。
 *   - A3 只比字符串字面量文本，`{"name"}` 的文本是带引号的 `"name"`，与末段 `name`
 *     不相等 → 漏判（Finding 5）。而 classifyEvidence 拿到的是运行时 textContent 'name'。
 *   - 模板字面量 `{`（${a} · ${b}）`}` 不含 '.'，被 `includes('.')` 前置条件跳过，
 *     四个对象级字段等于完全没有守卫（Finding 4）。
 * 改成走 AST 后，这三类都能按节点类型精确判定，且 `?.`（QuestionDotToken）
 * 天然与真正的 `??`（QuestionQuestionToken）区分开。
 */
function inspectFields(src, rel) {
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, /* setParentNodes */ true, ts.ScriptKind.TSX)
  const found = []

  /**
   * 局部 const 初始化表：变量名 → initializer，用于穿透「兜底一次、引用多处」。
   * 收集全部作用域（组件函数体内的 const 不在 sf.statements 里，只扫顶层会漏）。
   */
  const bindings = new Map()
  const collectBindings = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      bindings.set(node.name.text, node.initializer)
    }
    ts.forEachChild(node, collectBindings)
  }
  collectBindings(sf)

  /** 模块内定义的函数体：名字 → body，供穿透 formatVital 这类纯函数 */
  const localFns = new Map()
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name && st.body) localFns.set(st.name.text, st.body)
  }

  /**
   * A1/A2：children 是否保证产出非空可见文本。
   *
   * 穿透两类间接层（页面把它们放在声明处兜底一次、Field 处只引用）：
   *   1. 局部 const 引用 —— `const nameText = patient.name || DASH` 后 `{nameText}`
   *   2. 模块内函数调用 —— `const heartRateText = formatVital(v)` 而 formatVital 内部 `?? DASH`
   *      函数体一旦自身不可判定就不穿透（宁可误报也不漏判，见 formatVital 的 ?? DASH）。
   *   3. 模板字面量 —— 对象级字段的摘要 `` {`（${a} · ${b}）`} ``：模板恒有非空字面量
   *      前后缀（'（' 与 '）'），且插值逐个判定 —— 任一插值不安全即整体不安全。
   *
   * 关键：`?.`（QuestionDotToken）刻意不算兜底 —— a?.b 在 a=null 时求值为 undefined，
   * React 渲染不出内容，正是 A1 要防的空 span（Finding 3）。
   */
  function hasFallbackGuarantee(node, depth = 0) {
    if (!node || depth > 6) return false
    if (ts.isIdentifier(node) && bindings.has(node.text)) {
      return hasFallbackGuarantee(bindings.get(node.text), depth + 1)
    }
    // 本文件内定义的纯函数调用：函数体自身可判定才认
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && localFns.has(node.expression.text)) {
      const body = localFns.get(node.expression.text)
      return stmtsHaveGuarantee(body.statements, depth + 1)
    }
    // 模板字面量：前后缀非空 且 每个插值都安全
    if (ts.isTemplateExpression(node)) {
      if (node.head.text === '') return false
      for (const span of node.templateSpans) {
        if (!hasFallbackGuarantee(span.expression, depth + 1)) return false
      }
      return true
    }
    if (ts.isBinaryExpression(node)) {
      if (
        node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        node.operatorToken.kind === ts.SyntaxKind.BarBarToken
      ) {
        return true
      }
    }
    if (ts.isConditionalExpression(node)) return true
    // String(x) / Number(x) 等：递归进参数
    return ts.forEachChild(node, (c) => hasFallbackGuarantee(c, depth + 1)) ?? false
  }

  /** 一组语句里是否存在兜底（用于穿透函数体） */
  function stmtsHaveGuarantee(stmts, depth) {
    let ok = false
    const scan = (n) => {
      if (ok) return
      if (
        ts.isBinaryExpression(n) &&
        (n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
          n.operatorToken.kind === ts.SyntaxKind.BarBarToken)
      ) {
        ok = true
        return
      }
      if (ts.isConditionalExpression(n)) {
        ok = true
        return
      }
      ts.forEachChild(n, scan)
    }
    for (const s of stmts) scan(s)
    return ok
  }

  /** A3：children 是否是纯字面量；取其运行时文本（解掉 {"name"} 的引号） */
  function literalValueOf(node, depth = 0) {
    if (depth > 2) return undefined
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
    if (ts.isJsxExpression(node) && node.expression) return literalValueOf(node.expression, depth + 1)
    if (ts.isIdentifier(node) && bindings.has(node.text)) return literalValueOf(bindings.get(node.text), depth + 1)
    return undefined
  }

  const visit = (node) => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      if (node.tagName?.getText(sf) === 'Field') {
        const attrs = node.attributes?.properties ?? []
        const fieldAttr = attrs.find((p) => p.name && ts.isIdentifier(p.name) && p.name.text === 'field')
        const init = fieldAttr?.initializer
        const field = init && ts.isStringLiteral(init) ? init.text : undefined
        if (field !== undefined) {
          const children =
            ts.isJsxSelfClosingElement(node) || !node.parent?.children
              ? []
              : node.parent.children.filter((c) => !ts.isJsxText(c) || c.text.trim() !== '')
          found.push({ field, selfClosing: ts.isJsxSelfClosingElement(node), children })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  return found.map((e) => {
    const at = `${rel}: field="${e.field}"`
    const leaf = (e.field ?? '').split('.').pop() ?? ''
    if (e.selfClosing) {
      return { field: e.field, problem: `${at} 是自闭合 <Field />，渲染空 span → visible:false → suspicious（A1）` }
    }
    if (e.children.length === 0) {
      return { field: e.field, problem: `${at} 没有 children，会渲染空 span → suspicious（A1）` }
    }
    // 纯 JSX 文本 children：非空即可（文本不会等于字段名，除非字面写了末段）
    const onlyText = e.children.every((c) => ts.isJsxText(c))
    if (onlyText) {
      const joined = e.children.map((c) => c.text).join('').trim()
      if (joined === '') return { field: e.field, problem: `${at} 的 children 是空 JSX 文本 → 空 span（A1/A2）` }
      if (joined === leaf) return { field: e.field, problem: `${at} 的 children 恰为末段 "${leaf}" → weak（A3）` }
      return { field: e.field }
    }
    // 表达式 children：逐个判 A3 与 A1/A2
    const problems = []
    for (const child of e.children) {
      const expr = ts.isJsxExpression(child) ? child.expression : undefined
      if (!expr) continue
      const lit = literalValueOf(expr)
      if (lit !== undefined) {
        // A3：字面量字符串（含 {"name"} 形态）等于末段 → weak
        if (lit === leaf) problems.push(`${at} 的 children 字面量 "${lit}" 恰为末段 → weak（A3）`)
        if (lit.trim() === '') problems.push(`${at} 的 children 是空字面量 → 空 span（A1/A2）`)
        continue
      }
      // A1/A2：非字面量表达式必须自带兜底。模板字面量（含对象摘要）也算，
      // 故不再用 includes('.') 前置 —— 四个对象级字段同样受守卫。
      if (!hasFallbackGuarantee(expr)) {
        const text = expr.getText(sf)
        problems.push(
          `${at} 的 children {${text}} 无 ?? / || / 三元兜底 —— 可能渲染成空 span → suspicious（A1/A2）。` +
            `注意 a?.b 不算兜底（null 时求值为 undefined）`,
        )
      }
    }
    return problems.length ? { field: e.field, problem: problems.join('\n    ') } : { field: e.field }
  })
}

const inspected = []
for (const rel of PAGES) {
  let raw
  try {
    raw = readFileSync(new URL(rel, import.meta.url), 'utf8')
  } catch {
    problems.push(`${rel}: 文件不存在 —— 先写页面再跑本脚本`)
    continue
  }
  const src = stripComments(raw)
  for (const { field, problem } of inspectFields(src, rel)) {
    rendered.add(field)
    const at = `${rel}: field="${field}"`
    if (!paths.has(field)) problems.push(`${at} 不在 manifest 的 normalizedPath 集合中`)
    if (problem) problems.push(problem)
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
