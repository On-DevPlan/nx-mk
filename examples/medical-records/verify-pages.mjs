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
const ENTRY = './app/src/main.tsx'
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
   * 判定对象是「这个表达式本身的值」，不是「它内部任意角落有没有兜底」。
   * 前一版用 forEachChild 满树找 ?? / ||，导致三处假阴性（全部实测 exit=0）：
   *   - `{x ? a : b}`  —— 只看「有 ternary」，不看哪个分支空
   *   - `{x ?? ''}`    —— 只看「有 ??」，不看右操作数是空串
   *   - `{f(x || D)}`  —— 调用**参数**里的兜底被当成了调用**结果**的兜底
   * 现在按节点类型严格判定：
   *   ?? / ||   → 仅当右操作数自身非空（见 isNonEmptyValue）
   *   三元       → 仅当 whenTrue 与 whenFalse 各自都非空
   *   模板字面量 → head 非空 且 每个插值各自非空
   *   标识符     → 穿透到局部 const 的 initializer
   *   模块内纯函数调用 → 穿透函数体（返回值即调用结果，参数不参与判定）
   *   其他        → 一律 false（不向子树搜索兜底）
   *
   * 刻意排除 `?.`（QuestionDotToken）：a?.b 在 a=null 时求值为 undefined，
   * React 渲染不出内容，正是 A1 要防的空 span（Finding 3）。
   * 宁可误报：误报 exit 1 并点名字段，代价小；漏报会让假 100% 静默通过。
   */
  function hasFallbackGuarantee(node, depth = 0) {
    if (!node || depth > 6) return false
    // 穿透局部 const：`const nameText = patient.name || DASH` 后 `{nameText}`
    if (ts.isIdentifier(node) && bindings.has(node.text)) {
      return hasFallbackGuarantee(bindings.get(node.text), depth + 1)
    }
    // 模块内纯函数：返回值即结果，只看函数体，不看实参
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && localFns.has(node.expression.text)) {
      return stmtsHaveGuarantee(localFns.get(node.expression.text).statements, depth + 1)
    }
    return isNonEmptyValue(node, depth)
  }

  /**
   * 「这个表达式求值后是否恒为非空字符串」。
   * 注意与 hasFallbackGuarantee 的区别：这里**只看节点自身**，
   * 绝不递归进子表达式去找兜底 —— 那正是 `f(x || D)` 假阴性的成因。
   */
  function isNonEmptyValue(node, depth = 0) {
    if (!node || depth > 6) return false
    if (ts.isIdentifier(node)) {
      const text = node.getText(sf)
      // 已兜底过的局部变量（DASH 等常量本身就是非空字面量）
      if (text === 'DASH') return true
      if (bindings.has(text)) return isNonEmptyValue(bindings.get(text), depth + 1)
      return false
    }
    // 兜底算子：只有当**右操作数**自身非空才算数
    if (ts.isBinaryExpression(node)) {
      const k = node.operatorToken.kind
      if (k === ts.SyntaxKind.QuestionQuestionToken || k === ts.SyntaxKind.BarBarToken) {
        return isNonEmptyValue(node.right, depth + 1)
      }
      return false
    }
    // 三元：两个分支都要非空
    if (ts.isConditionalExpression(node)) {
      return isNonEmptyValue(node.whenTrue, depth + 1) && isNonEmptyValue(node.whenFalse, depth + 1)
    }
    // 模板：head 非空 且 每个插值非空
    if (ts.isTemplateExpression(node)) {
      if (node.head.text.trim() === '') return false
      return node.templateSpans.every((sp) => isNonEmptyValue(sp.expression, depth + 1))
    }
    if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text.trim() !== ''
    if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text.trim() !== ''
    // 属性访问链（visit.diagnosis / patient.contact.phone）：非空类型字段的读取本身可信。
    // 只在链上出现 undefined / 空字面量 / 可选链时才判不可信 —— 否则「两分支皆可信」的
    // 三元写法（如 {c ? p.name : p.name || DASH}）会被误报，而它运行时确实非空。
    if (ts.isPropertyAccessExpression(node)) {
      return !chainHasHole(node)
    }
    // String(x) / Number(x) 等简单包装：包住一个非空值即可（实参本身仍须非空）
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const fn = node.expression.text
      if ((fn === 'String' || fn === 'Number') && node.arguments.length === 1) {
        return isNonEmptyValue(node.arguments[0], depth + 1)
      }
      // 模块内纯函数：返回值即结果（formatVital 的 `String(v ?? DASH)`）
      if (localFns.has(fn)) return stmtsHaveGuarantee(localFns.get(fn).statements, depth + 1)
      return false
    }
    return false
  }

  /** 属性访问链上是否存在空洞：可选链 ?.、字面量 undefined/null/'' 、或可选索引 */
  function chainHasHole(node) {
    let cur = node
    while (cur) {
      if (ts.isPropertyAccessChain(cur) || ts.isElementAccessChain(cur)) return true
      if (ts.isIdentifier(cur) && cur.getText(sf) === 'undefined') return true
      cur = cur.expression
    }
    return false
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
        // 右操作数必须自身非空，否则 `x ?? ''` 这类空兜底会被放过
        if (isNonEmptyValue(n.right)) {
          ok = true
          return
        }
      }
      if (ts.isConditionalExpression(n)) {
        if (isNonEmptyValue(n.whenTrue) && isNonEmptyValue(n.whenFalse)) {
          ok = true
          return
        }
      }
      if (
        ts.isReturnStatement(n) &&
        n.expression &&
        (ts.isStringLiteral(n.expression) || ts.isNoSubstitutionTemplateLiteral(n.expression))
      ) {
        // 直接 return 非空字面量也算（如 formatVital 的兜底分支）
        if (n.expression.text.trim() !== '') {
          ok = true
          return
        }
      }
      ts.forEachChild(n, scan)
    }
    for (const s of stmts) scan(s)
    return ok
  }

  /**
   * A3：children 的**渲染文本**是否恰为字段名末段。
   * 解引号（{"name"} / {`name`}），并穿透局部 const 与三元两个分支 ——
   * `<span>{'id'}</span>` 这类包裹形态在旧实现里被整体跳过（只收顶层 JsxExpression）。
   */
  function literalTextsOf(node, depth = 0) {
    if (!node || depth > 3) return []
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text]
    if (ts.isJsxExpression(node)) return node.expression ? literalTextsOf(node.expression, depth + 1) : []
    if (ts.isJsxElement(node)) {
      // 包裹元素：递归其 children 的全部字面量（<span>{'id'}</span>）
      return (node.children ?? []).flatMap((c) => literalTextsOf(c, depth + 1))
    }
    if (ts.isJsxFragment(node)) {
      return (node.children ?? []).flatMap((c) => literalTextsOf(c, depth + 1))
    }
    if (ts.isIdentifier(node) && bindings.has(node.text)) {
      return literalTextsOf(bindings.get(node.text), depth + 1)
    }
    if (ts.isConditionalExpression(node)) {
      return [
        ...literalTextsOf(node.whenTrue, depth + 1),
        ...literalTextsOf(node.whenFalse, depth + 1),
      ]
    }
    return []
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
    // 收集所有「含表达式的子树」：顶层 JsxExpression 一律收；
    // 嵌套 JsxElement / JsxFragment 也要递归进去 —— 否则 <span>{x}</span> 会被整体跳过。
    const exprNodes = []
    const collectExprs = (n) => {
      if (ts.isJsxExpression(n)) {
        if (n.expression) exprNodes.push(n.expression)
        return
      }
      // JsxElement / JsxFragment：递归其 children（<span>{x}</span> 不能被跳过）
      if (ts.isJsxElement(n) || ts.isJsxFragment(n)) {
        for (const c of n.children ?? []) collectExprs(c)
      }
    }
    for (const child of e.children) collectExprs(child)
    // 包裹元素自身也可能带字面量文本（<span>id</span>）
    for (const child of e.children) {
      for (const lit of literalTextsOf(child)) {
        if (lit === leaf) problems.push(`${at} 的 children 含字面量 "${lit}" 恰为末段 → weak（A3）`)
        if (lit.trim() === '' && child !== undefined) {
          // 空字面量单独判：仅当整个 children 就是它时才判空 span
          if (literalTextsOf(child).length === 1 && e.children.length === 1) {
            problems.push(`${at} 的 children 是空字面量 → 空 span（A1/A2）`)
          }
        }
      }
    }
    for (const expr of exprNodes) {
      const lits = literalTextsOf(expr)
      if (lits.length) {
        // A3：字面量字符串（含 {"name"} / {`name`} / <span>{'id'}</span>）等于末段 → weak
        if (lits.some((l) => l === leaf)) {
          problems.push(`${at} 的 children 字面量 ${JSON.stringify(lits)} 含末段 "${leaf}" → weak（A3）`)
        }
        continue
      }
      // A1/A2：非字面量表达式必须自身保证非空。模板字面量（含对象摘要）也算，
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

/**
 * 挂载点断言 —— main.tsx 必须为**每个** fixture 患者挂上 PatientDetail / VisitHistory。
 *
 * 为什么需要（Finding 1）：p_002 承载 nullable 与空数组两个验证点
 * （notes: null、medications: []）。只挂 p_001 时页面仍能通过上面所有检查，
 * 两个分支却在运行时永远走不到 —— A1/A2 防护退化为「构造正确但无法观测」。
 * 场景 DSL 无 click/fill，无法靠第二个 goto 切换，故只能靠 render-both：
 * 单页挂两个实例，一次 goto 覆盖两个分支。
 *
 * 患者 id 从 server 源码的 PATIENTS fixture 读出（而非写死 p_001/p_002）：
 * 以后增删 fixture，本断言自动跟随，不会悄悄失效。
 */
function checkMounts() {
  const serverRel = './server/src/index.ts'
  let serverSrc
  let entrySrc
  try {
    serverSrc = readFileSync(new URL(serverRel, import.meta.url), 'utf8')
    entrySrc = readFileSync(new URL(ENTRY, import.meta.url), 'utf8')
  } catch (e) {
    problems.push(`挂载点断言无法读取 ${serverRel} / ${ENTRY}：${e.message}`)
    return
  }
  // PATIENTS 数组里的 id: 'p_001' / 'p_002'
  const fixtureBlock = serverSrc.match(/const PATIENTS\s*=\s*\[([\s\S]*?)\n\]/)
  if (!fixtureBlock) {
    problems.push(`${serverRel}: 找不到 PATIENTS fixture，无法确定应挂载哪些患者`)
    return
  }
  const patientIds = [...fixtureBlock[1].matchAll(/\bid:\s*'([^']+)'/g)].map((m) => m[1])
  if (patientIds.length === 0) {
    problems.push(`${serverRel}: PATIENTS fixture 里解析不到任何 id`)
    return
  }
  const entry = stripComments(entrySrc)
  for (const id of patientIds) {
    for (const comp of ['PatientDetail', 'VisitHistory']) {
      // 该组件必须至少一处带 patientId="<id>" 挂载
      const re = new RegExp(`<${comp}\\b[^>]*\\bpatientId=["'{]\\s*["']?${id}\\b`, 's')
      if (!re.test(entry)) {
        problems.push(
          `${ENTRY}: 没有找到 <${comp} patientId="${id}" /> 的挂载 —— ` +
            `fixture 患者 ${id} 的运行时数据不会被渲染，A1/A2 分支无法观测`,
        )
      }
    }
  }
  return patientIds
}

const mountedPatients = checkMounts()

if (problems.length) {
  console.error('页面静态验证失败:\n  ' + problems.join('\n  '))
  process.exit(1)
}
console.log(
  `[verify-pages] 页面 Field 字面量全部合法（${PAGES.length} 个文件，` +
    `渲染 ${rendered.size} 个唯一路径，本任务分母 ${ownedPaths.size} 个全命中` +
    (mountedPatients ? `，main.tsx 覆盖 ${mountedPatients.length} 个 fixture 患者` : '') +
    `）`,
)
