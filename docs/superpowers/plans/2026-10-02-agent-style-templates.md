# Agent Style Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户在 `nx-mk.config.yml` 的 `agent.style` 段选择风格模板（内置 id 或自定义 markdown 路径），api-ui-agent 的 prompt 携带风格规范，review guard 新增 G5 className 白名单校验——使交付前端风格从「LLM 自觉」变为「配置确定」。

**Architecture:** 新增 `packages/agent/src/style/` 子模块（types / loader / guard-classname / host-classes / templates），纯函数可注入；`AgentContext` 增加可选 `style` 字段作为 runtime → agent/guard 的单一传递通道；config 包扩 `AgentStyleConfigSchema`；review.ts 在既有 G1-G4 检查链上并列追加 G5。

**Tech Stack:** TypeScript ESM、zod（config schema）、`yaml`（frontmatter 解析，workspace 已有）、node:fs 递归目录扫描（无新 glob 依赖）、vitest。

**Spec:** `docs/superpowers/specs/2026-10-02-nx-mk-agent-style-templates-design.md`（本计划从 spec 论证，执行者须两份都读）

## Global Constraints

- 语言/注释风格：与仓库一致——中文注释 + spec § 编号引用（本 spec 编号形如 §2.4、DS3）
- D1 铁律不破：全链路零工作区写入（style 体系只影响 prompt 文本与 guard 判定，不新增任何写盘路径）
- 兼容铁律（DS3）：`agent.style` 不配置时——prompt 输出与现网**逐字节一致**；review checks 数组**不新增条目**；765 测试基线不许动
- KernelError 约定：config 语义错误一律 `new KernelError('CONFIG_INVALID', msg, null)`，进程级 fail-fast
- 文件纪律：单文件 ≤ 400 行（用户全局编码规范）
- 测试纪律：不触真 claude CLI；G5 的宿主类集合走 `inject.hostClasses` 注入
- Windows 注意：路径拼接一律 `node:path`（`join`/`resolve`/`isAbsolute`），diff 行切分用 `/\r?\n/`
- 提交信息：Conventional Commits，结尾 `Co-Authored-By: Claude Code <noreply@anthropic.com>`

## Review Focus

1. **CRLF diff 行**：claude 在 Windows 产的 diff 可能带 `\r`——`extractClassTokens` 输入须先容忍行尾 `\r`（review.ts 的 `addedLines` 已按 `/\r?\n/` 切行但行尾可能留 `\r`）。期望：`className="flex"\r` 仍提取出 `flex`。→ Task 5 测试钉死。
2. **`class={动态表达式}`**：`className={styles.foo}` 或模板字符串提取不出静态 token——期望：跳过不误报（宁可漏检不可误杀合法 patch）。→ Task 5 测试钉死。
3. **auto-detect 显式配置**：用户显式写 `style: { id: auto-detect }` 时 prompt 段**不渲染**但 G5 仍生效（宿主扫描）。期望：与不配置 behavior 的差别仅在 G5 检查条目出现。→ Task 4/5 测试钉死。
4. **自定义模板路径含中文/空格**：Windows 用户目录常见——`path.resolve` 直拼即可，但错误信息里的路径须原样可读（不做 slug 化）。→ Task 2 错误信息断言钉死。
5. **宿主扫描零命中**：全新项目无任何 css/tsx——G5 违规 detail 须附「宿主未检出任何既有 class」提示而非静默拒绝（spec §3 末行）。→ Task 5 测试钉死。

---

### Task 1: style 模块地基——types + markdown 契约解析器

**Files:**
- Create: `packages/agent/src/style/types.ts`
- Create: `packages/agent/src/style/loader.ts`（本 task 只实现 `parseStyleMarkdown`；`loadStyleTemplate` 在 Task 2）
- Create: `packages/agent/src/style/__tests__/loader.test.ts`
- Modify: `packages/agent/package.json`（dependencies 加 `"yaml": "^2.4.5"`）
- Modify: `packages/agent/src/index.ts`（追加 style 出口，见 Step 5）

**Interfaces:**
- Consumes: 无（地基任务）
- Produces（后续任务依赖的精确签名）:
  ```ts
  // style/types.ts
  export interface StyleTemplate {
    id: string
    source: 'built-in' | 'custom'
    classNameWhitelist?: string[]   // 缺省 = auto-detect 语义（G5 宿主扫描）
    description: string
    rules: string[]
  }
  export interface StyleConfigInput {   // 与 config 包 AgentStyleConfigSchema 逐字同构（PLN-3 镜像）
    id?: string
    path?: string
    overrides?: Record<string, string>
  }
  // style/loader.ts（本 task 交付前两个）
  export function parseStyleMarkdown(text: string, source: 'built-in' | 'custom', fallbackId: string): StyleTemplate
  export class StyleTemplateError extends KernelError  // 语义：CONFIG_INVALID 的 style 专用别名（构造即 code='CONFIG_INVALID'）
  ```

- [ ] **Step 1: 加 yaml 依赖**

`packages/agent/package.json` 的 `dependencies` 块加入（workspace lockfile 已含该包，config 在用）：

```json
"yaml": "^2.4.5",
```

然后 `pnpm install --filter @nx-mk/agent`。

- [ ] **Step 2: 写失败测试（解析器契约）**

`packages/agent/src/style/__tests__/loader.test.ts`：

```ts
/**
 * style loader 单测（spec §2.2 契约 + §3 错误路径）：parseStyleMarkdown 纯函数部分。
 */
import { describe, it, expect } from 'vitest'
import { parseStyleMarkdown, StyleTemplateError } from '../loader.js'

const GOOD = `---
id: my-style
classNameWhitelist: ["flex", "px-*"]
---
使用宿主既有 className 惯例。

## Hard rules
- 只复用宿主已有的 class
- 禁止内联 style
`

describe('parseStyleMarkdown', () => {
  it('parses frontmatter id/whitelist, description and rules from the contract format', () => {
    const t = parseStyleMarkdown(GOOD, 'custom', 'fallback-stem')
    expect(t.id).toBe('my-style')
    expect(t.source).toBe('custom')
    expect(t.classNameWhitelist).toEqual(['flex', 'px-*'])
    expect(t.description).toBe('使用宿主既有 className 惯例。')
    expect(t.rules).toEqual(['只复用宿主已有的 class', '禁止内联 style'])
  })

  it('falls back to the stem id when frontmatter has no id', () => {
    const t = parseStyleMarkdown('---\n---\n描述正文。\n\n## Hard rules\n- 规则\n', 'custom', 'stem-id')
    expect(t.id).toBe('stem-id')
    expect(t.classNameWhitelist).toBeUndefined()
  })

  it('parses block-style yaml arrays too', () => {
    const text = '---\nclassNameWhitelist:\n  - flex\n  - grid\n---\nD。\n\n## Hard rules\n- R\n'
    expect(parseStyleMarkdown(text, 'custom', 'x').classNameWhitelist).toEqual(['flex', 'grid'])
  })

  it('throws StyleTemplateError (CONFIG_INVALID) when ## Hard rules section is missing', () => {
    expect(() => parseStyleMarkdown('---\n---\n只有描述。\n', 'custom', 'x'))
      .toThrow(StyleTemplateError)
    try {
      parseStyleMarkdown('---\n---\n只有描述。\n', 'custom', 'x')
    } catch (err) {
      expect((err as Error).message).toContain('## Hard rules')
      expect((err as Error).message).toContain('模板格式')
    }
  })

  it('throws when description body is empty', () => {
    expect(() => parseStyleMarkdown('---\n---\n\n## Hard rules\n- r\n', 'custom', 'x'))
      .toThrow(StyleTemplateError)
  })

  it('throws when classNameWhitelist is not an array of strings', () => {
    expect(() => parseStyleMarkdown('---\nclassNameWhitelist: flex\n---\nD\n\n## Hard rules\n- r\n', 'custom', 'x'))
      .toThrow(StyleTemplateError)
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm --filter @nx-mk/agent exec vitest run src/style/__tests__/loader.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 4: 实现 types + 解析器**

`packages/agent/src/style/types.ts`：

```ts
/**
 * 风格模板类型（spec §2.2）—— StyleTemplate 是 prompt 注入与 G5 guard 的共享契约。
 * StyleConfigInput 与 @nx-mk/config AgentStyleConfigSchema 逐字同构（PLN-3 镜像约定）。
 */
export interface StyleTemplate {
  id: string
  source: 'built-in' | 'custom'
  classNameWhitelist?: string[]   // 缺省 = auto-detect 语义（G5 宿主扫描兜底）
  description: string
  rules: string[]
}

export interface StyleConfigInput {
  id?: string
  path?: string
  overrides?: Record<string, string>
}
```

`packages/agent/src/style/loader.ts`：

```ts
/**
 * 风格模板 loader（spec §2.2 契约 + §3 错误路径）。
 * parseStyleMarkdown：markdown 契约文本 → StyleTemplate（纯函数）。
 * loadStyleTemplate 在 Task 2 落地（内置注册表 + 自定义 path + overrides）。
 */
import { parse as parseYaml } from 'yaml'
import { KernelError } from '@nx-mk/kernel'
import type { StyleTemplate } from './types.js'

// style 专用错误别名：config 语义错误统一 CONFIG_INVALID（spec §3 fail-fast）
export class StyleTemplateError extends KernelError {
  constructor(message: string) {
    super('CONFIG_INVALID', message, null)
  }
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/
const HARD_RULES_HEADING = /^##\s+Hard rules\s*$/m

// markdown 契约（spec §2.2）：frontmatter(id?/classNameWhitelist?) + 描述正文 + '## Hard rules' 列表
export function parseStyleMarkdown(text: string, source: 'built-in' | 'custom', fallbackId: string): StyleTemplate {
  const m = FRONTMATTER.exec(text)
  if (!m) {
    throw new StyleTemplateError(
      `style template must start with YAML frontmatter (--- ... ---). 模板格式：\n---\nid: my-style\nclassNameWhitelist: ["flex"]\n---\n描述正文。\n\n## Hard rules\n- 规则`,
    )
  }
  let meta: Record<string, unknown>
  try {
    meta = (parseYaml(m[1]!) ?? {}) as Record<string, unknown>
  } catch (err) {
    throw new StyleTemplateError(`style template frontmatter is not valid YAML: ${err instanceof Error ? err.message : String(err)}`)
  }

  const body = m[2] ?? ''
  const headingIdx = body.search(HARD_RULES_HEADING)
  if (headingIdx === -1) {
    throw new StyleTemplateError(`style template is missing a '## Hard rules' section. 模板格式：\n描述正文。\n\n## Hard rules\n- 规则`)
  }
  const description = body.slice(0, headingIdx).trim()
  if (description.length === 0) {
    throw new StyleTemplateError(`style template description (before '## Hard rules') is empty`)
  }
  const rules = body
    .slice(headingIdx)
    .split(/\r?\n/)
    .slice(1) // 丢掉标题行本身
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2).trim())
    .filter((l) => l.length > 0)
  if (rules.length === 0) {
    throw new StyleTemplateError(`style template '## Hard rules' section has no rule items (- 前缀列表)`)
  }

  const rawWhitelist = meta.classNameWhitelist
  if (rawWhitelist !== undefined) {
    if (!Array.isArray(rawWhitelist) || rawWhitelist.some((v) => typeof v !== 'string')) {
      throw new StyleTemplateError(`style template classNameWhitelist must be a YAML array of strings`)
    }
  }

  const id = typeof meta.id === 'string' && meta.id.trim().length > 0 ? meta.id.trim() : fallbackId
  return {
    id,
    source,
    ...(Array.isArray(rawWhitelist) ? { classNameWhitelist: rawWhitelist as string[] } : {}),
    description,
    rules,
  }
}
```

- [ ] **Step 5: 跑测试确认通过 + index 出口**

Run: `pnpm --filter @nx-mk/agent exec vitest run src/style/__tests__/loader.test.ts`
Expected: PASS（6 tests）

`packages/agent/src/index.ts` 末尾追加：

```ts
export {
  parseStyleMarkdown,
  StyleTemplateError,
  type StyleTemplate,
  type StyleConfigInput,
} from './style/index-pub.js'
```

同时创建 `packages/agent/src/style/index-pub.ts`（本 task 只出口这两项；Task 2/5 追加）：

```ts
/**
 * style 子模块公开出口（spec §2）—— index.ts 只从这里 re-export，避免深层路径扩散。
 */
export { parseStyleMarkdown, StyleTemplateError } from './loader.js'
export type { StyleTemplate, StyleConfigInput } from './types.js'
```

- [ ] **Step 6: typecheck + Commit**

Run: `pnpm --filter @nx-mk/agent typecheck`
Expected: exit 0

```bash
git add packages/agent/src/style packages/agent/src/index.ts packages/agent/package.json pnpm-lock.yaml
git commit -m "feat(agent): style 模板地基 —— StyleTemplate 类型 + markdown 契约解析器（spec §2.2）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: 内置模板注册表 + loadStyleTemplate（解析优先级 / overrides / fail-fast）

**Files:**
- Create: `packages/agent/src/style/templates/tailwind-lite.ts`
- Create: `packages/agent/src/style/templates/semantic-css.ts`
- Create: `packages/agent/src/style/templates/mui-style.ts`
- Create: `packages/agent/src/style/templates/unstyled.ts`
- Modify: `packages/agent/src/style/loader.ts`（追加注册表 + `loadStyleTemplate`）
- Modify: `packages/agent/src/style/index-pub.ts`（追加出口）
- Test: `packages/agent/src/style/__tests__/loader.test.ts`（追加 describe）

**Interfaces:**
- Consumes: Task 1 的 `parseStyleMarkdown` / `StyleTemplateError` / `StyleTemplate` / `StyleConfigInput`
- Produces:
  ```ts
  // style/loader.ts 追加
  export const BUILTIN_STYLE_IDS = ['tailwind-lite', 'semantic-css', 'mui-style', 'unstyled', 'auto-detect'] as const
  export function loadStyleTemplate(
    cfg: StyleConfigInput | undefined,
    opts?: { projectRoot?: string; log?: (msg: string) => void },
  ): StyleTemplate
  // cfg === undefined → auto-detect 字面对象（不渲染 prompt 段，G5 宿主扫描；spec DS3）
  // 语义错误 → StyleTemplateError（进程级 fail-fast，spec §3）
  ```

- [ ] **Step 1: 写失败测试（注册表 + 解析优先级 + 错误路径 + overrides）**

在 `loader.test.ts` 追加：

```ts
import { loadStyleTemplate, BUILTIN_STYLE_IDS } from '../loader.js'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

describe('loadStyleTemplate', () => {
  const tmpRoot = join(tmpdir(), 'nx-mk-style-test')
  const warnings: string[] = []
  const log = (m: string) => warnings.push(m)

  it('exposes exactly the 5 documented built-in ids', () => {
    expect([...BUILTIN_STYLE_IDS]).toEqual(['tailwind-lite', 'semantic-css', 'mui-style', 'unstyled', 'auto-detect'])
  })

  it('undefined config → auto-detect literal (empty description/rules, no whitelist)', () => {
    const t = loadStyleTemplate(undefined)
    expect(t.id).toBe('auto-detect')
    expect(t.source).toBe('built-in')
    expect(t.classNameWhitelist).toBeUndefined()
    expect(t.description).toBe('')
    expect(t.rules).toEqual([])
  })

  it('loads each built-in by id with non-empty description and rules', () => {
    for (const id of ['tailwind-lite', 'semantic-css', 'mui-style', 'unstyled']) {
      const t = loadStyleTemplate({ id })
      expect(t.id).toBe(id)
      expect(t.source).toBe('built-in')
      expect(t.description.length).toBeGreaterThan(0)
      expect(t.rules.length).toBeGreaterThan(0)
    }
  })

  it('tailwind-lite ships a classNameWhitelist; the other four do not', () => {
    expect(loadStyleTemplate({ id: 'tailwind-lite' }).classNameWhitelist?.length).toBeGreaterThan(0)
    for (const id of ['semantic-css', 'mui-style', 'unstyled'] as const) {
      expect(loadStyleTemplate({ id }).classNameWhitelist).toBeUndefined()
    }
  })

  it('unknown id without path → fail-fast listing built-ins', () => {
    try {
      loadStyleTemplate({ id: 'nope' })
      expect.unreachable()
    } catch (err) {
      expect((err as Error).message).toContain('nope')
      for (const id of BUILTIN_STYLE_IDS) expect((err as Error).message).toContain(id)
    }
  })

  it('custom path wins over id, with a warning', () => {
    mkdirSync(tmpRoot, { recursive: true })
    const p = join(tmpRoot, 'my style 模板.md')   // Review Focus #4：中文 + 空格路径
    writeFileSync(p, '---\nid: custom-one\n---\n自定义描述。\n\n## Hard rules\n- 自定义规则\n')
    const t = loadStyleTemplate({ id: 'tailwind-lite', path: 'my style 模板.md' }, { projectRoot: tmpRoot, log })
    expect(t.id).toBe('custom-one')
    expect(t.source).toBe('custom')
    expect(warnings.some((w) => w.includes('path'))).toBe(true)
  })

  it('missing custom path file → fail-fast with the absolute path echoed verbatim', () => {
    try {
      loadStyleTemplate({ path: 'no-such.md' }, { projectRoot: tmpRoot })
      expect.unreachable()
    } catch (err) {
      const msg = (err as Error).message
      expect(msg).toContain(resolve(tmpRoot, 'no-such.md'))
      expect(msg).toContain('相对')
    }
  })

  it('empty whitelist array (id != auto-detect) → allowed with warning', () => {
    mkdirSync(tmpRoot, { recursive: true })
    writeFileSync(join(tmpRoot, 'empty-wl.md'), '---\nid: ew\nclassNameWhitelist: []\n---\nD\n\n## Hard rules\n- r\n')
    warnings.length = 0
    const t = loadStyleTemplate({ path: 'empty-wl.md' }, { projectRoot: tmpRoot, log })
    expect(t.classNameWhitelist).toEqual([])
    expect(warnings.some((w) => w.includes('auto-detect'))).toBe(true)
  })

  it('overrides interpolate {{key}} in description; unreplaced keys warn', () => {
    mkdirSync(tmpRoot, { recursive: true })
    writeFileSync(join(tmpRoot, 'tpl.md'), '---\nid: tpl\n---\n主题色 {{color}}。\n\n## Hard rules\n- r\n')
    warnings.length = 0
    const t = loadStyleTemplate({ path: 'tpl.md', overrides: { color: '蓝' } }, { projectRoot: tmpRoot, log })
    expect(t.description).toBe('主题色 蓝。')

    const t2 = loadStyleTemplate({ path: 'tpl.md' }, { projectRoot: tmpRoot, log })
    expect(t2.description).toBe('主题色 {{color}}。')
    expect(warnings.some((w) => w.includes('color'))).toBe(true)
  })

  it('cleans up tmp root', () => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @nx-mk/agent exec vitest run src/style/__tests__/loader.test.ts`
Expected: FAIL（loadStyleTemplate / BUILTIN_STYLE_IDS 不存在）

- [ ] **Step 3: 写 4 个内置模板（TS 字符串承载 markdown 契约，spec §2.1 实现修订）**

`packages/agent/src/style/templates/tailwind-lite.ts`：

```ts
/**
 * 内置风格模板 tailwind-lite（spec §2.3）—— utility-first。
 * TS 字符串承载 markdown 契约（§2.1 实现修订：tsup 不拷贝 .md 资产）；内容对模板作者即范例。
 */
export const tailwindLiteTemplate = `---
id: tailwind-lite
classNameWhitelist: ["flex","grid","block","hidden","px-*","py-*","p-*","m-*","mx-*","my-*","mt-*","mb-*","ml-*","mr-*","gap-*","w-*","h-*","min-h-*","max-w-*","text-*","bg-*","border","border-*","rounded","rounded-*","font-*","items-*","justify-*","space-*","list-*","truncate","uppercase","italic","sr-only"]
---
Utility-first Tailwind styling. Compose layout and visual styling with Tailwind utility classes only.

## Hard rules
- Use Tailwind utility classes for all styling; never create or modify CSS files.
- Never use inline style attributes.
- Never import third-party UI component libraries.
`
```

`packages/agent/src/style/templates/semantic-css.ts`：

```ts
/**
 * 内置风格模板 semantic-css（spec §2.3）—— 复用宿主语义 class；白名单缺省 → G5 宿主扫描。
 */
export const semanticCssTemplate = `---
id: semantic-css
---
The host project uses hand-written semantic CSS classes defined in its own stylesheets. Reuse the existing class vocabulary; the review guard rejects classNames that do not exist in the host project.

## Hard rules
- Reuse classes that already exist in the host stylesheets; never invent new class names.
- Never add utility-framework classes (e.g. Tailwind) unless they are already used in the host project.
- Never use inline style attributes.
`
```

`packages/agent/src/style/templates/mui-style.ts`：

```ts
/**
 * 内置风格模板 mui-style（spec §2.3）—— MUI 组件优先；白名单不适用 → 缺省（宿主扫描）。
 */
export const muiStyleTemplate = `---
id: mui-style
---
The host project is styled with Material UI (MUI) components. Prefer MUI components and the sx prop over raw HTML plus class strings.

## Hard rules
- Use MUI components (from @mui/material) for structure; do not introduce other UI libraries.
- Prefer the sx prop for one-off tweaks; never create CSS files.
- Never use className strings that are not already defined by the host project.
`
```

`packages/agent/src/style/templates/unstyled.ts`：

```ts
/**
 * 内置风格模板 unstyled（spec §2.3）—— 纯结构渲染，无装饰样式。
 */
export const unstyledTemplate = `---
id: unstyled
---
Minimal structural rendering: plain semantic HTML elements with no decorative styling. Coverage evidence matters, visuals do not.

## Hard rules
- Use plain semantic HTML elements only; no styling classes, no inline styles.
- Keep markup minimal: render each required field as readable text.
`
```

- [ ] **Step 4: 实现注册表 + loadStyleTemplate**

`packages/agent/src/style/loader.ts` 追加：

```ts
import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { tailwindLiteTemplate } from './templates/tailwind-lite.js'
import { semanticCssTemplate } from './templates/semantic-css.js'
import { muiStyleTemplate } from './templates/mui-style.js'
import { unstyledTemplate } from './templates/unstyled.js'
import type { StyleConfigInput } from './types.js'

// 内置注册表（spec §2.3）：4 个 markdown 契约模板 + auto-detect 字面对象（DS3：不渲染 prompt 段）
const BUILTIN_TEMPLATES: Record<string, StyleTemplate> = {
  'tailwind-lite': parseStyleMarkdown(tailwindLiteTemplate, 'built-in', 'tailwind-lite'),
  'semantic-css': parseStyleMarkdown(semanticCssTemplate, 'built-in', 'semantic-css'),
  'mui-style': parseStyleMarkdown(muiStyleTemplate, 'built-in', 'mui-style'),
  unstyled: parseStyleMarkdown(unstyledTemplate, 'built-in', 'unstyled'),
  // auto-detect：空 description/rules —— buildPrompt 对该 id 不渲染风格段（spec §2.4）；
  // G5 按白名单缺省语义走宿主扫描（spec §2.5）。
  'auto-detect': { id: 'auto-detect', source: 'built-in', description: '', rules: [] },
}

export const BUILTIN_STYLE_IDS = Object.keys(BUILTIN_TEMPLATES) as unknown as readonly string[]

const PLACEHOLDER = /\{\{(\w+)\}\}/g

// 解析优先级（spec §2.2）：path > id > auto-detect；语义错误全部 StyleTemplateError（§3 fail-fast）
export function loadStyleTemplate(
  cfg: StyleConfigInput | undefined,
  opts?: { projectRoot?: string; log?: (msg: string) => void },
): StyleTemplate {
  const log = opts?.log ?? (() => {})

  // Review Focus #3：显式 auto-detect 与未配置同形（空描述对象；G5 行为由 review.ts 按 id 分派）
  if (!cfg || (!cfg.id && !cfg.path)) return { ...BUILTIN_TEMPLATES['auto-detect']! }

  let template: StyleTemplate
  if (cfg.path) {
    if (cfg.id) log(`[style] both id and path configured — path wins (${cfg.path})`) // §3
    const abs = isAbsolute(cfg.path) ? cfg.path : resolve(opts?.projectRoot ?? process.cwd(), cfg.path)
    let text: string
    try {
      text = readFileSync(abs, 'utf8')
    } catch (err) {
      throw new StyleTemplateError(
        `style template file not readable: ${abs}（应为相对 nx-mk.config.yml 的路径，或绝对路径）: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    const stem = cfg.path.replace(/\\/g, '/').split('/').pop()!.replace(/\.md$/i, '')
    template = { ...parseStyleMarkdown(text, 'custom', stem) }  // path 模式 id 以 frontmatter（缺省 stem）为准；cfg.id 不参与
  } else {
    const builtin = BUILTIN_TEMPLATES[cfg.id!]
    if (!builtin) {
      throw new StyleTemplateError(
        `unknown style template id: "${cfg.id}". available built-ins: ${BUILTIN_STYLE_IDS.join(', ')}（自定义模板请改用 agent.style.path）`,
      )
    }
    template = { ...builtin }
  }

  // §3：空白名单（非 auto-detect）→ 警告（等效宿主扫描兜底）
  if (template.classNameWhitelist !== undefined && template.classNameWhitelist.length === 0 && template.id !== 'auto-detect') {
    log(`[style] template "${template.id}" has an empty classNameWhitelist — G5 falls back to host-project class scan (auto-detect semantics)`)
  }

  // overrides：description {{key}} 插值；未提供的占位符保留原样 + 警告（spec §2.2）
  const overrides = cfg.overrides ?? {}
  template.description = template.description.replace(PLACEHOLDER, (raw, key: string) => {
    if (key in overrides) return overrides[key]!
    log(`[style] template "${template.id}" placeholder {{${key}}} has no override — left as-is`)
    return raw
  })

  return template
}
```

> ⚠️ 实现注意：`if (cfg.path)` 块的 id 语义——path 模式下模板 id 一律取 frontmatter `id`（缺省 stem）；`cfg.id` 在 path 模式下不参与覆盖（只触发 path-wins 警告）。

`packages/agent/src/style/index-pub.ts` 改为：

```ts
/**
 * style 子模块公开出口（spec §2）—— index.ts 只从这里 re-export，避免深层路径扩散。
 */
export { parseStyleMarkdown, StyleTemplateError, loadStyleTemplate, BUILTIN_STYLE_IDS } from './loader.js'
export type { StyleTemplate, StyleConfigInput } from './types.js'
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm --filter @nx-mk/agent exec vitest run src/style/__tests__/loader.test.ts`
Expected: PASS（Task 1 的 6 个 + 本 task 10 个）

- [ ] **Step 6: typecheck + Commit**

Run: `pnpm --filter @nx-mk/agent typecheck`
Expected: exit 0

```bash
git add packages/agent/src/style
git commit -m "feat(agent): 内置风格模板注册表 + loadStyleTemplate（spec §2.3/§3，path>id>auto-detect）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: config schema 扩展 + agent 侧镜像类型

**Files:**
- Modify: `packages/config/src/schema.ts`（`AgentStyleConfigSchema` + 挂进 `AgentConfigSchema`）
- Modify: `packages/agent/src/types.ts`（`AgentConfig` 镜像加 `style`；`AgentContext` 加 `style`）
- Test: `packages/config/src/__tests__/agent-schema.test.ts`（追加用例）

**Interfaces:**
- Consumes: 无（schema 层）
- Produces:
  ```ts
  // packages/config/src/schema.ts 新增并 export
  export const AgentStyleConfigSchema = z.object({
    id: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    overrides: z.record(z.string()).optional(),
  }).strict()                          // spec §1.4：strict 拒绝未知键
  export type AgentStyleConfig = z.infer<typeof AgentStyleConfigSchema>
  // AgentConfigSchema 加一行：style: AgentStyleConfigSchema.optional(),
  ```
  ```ts
  // packages/agent/src/types.ts 镜像（PLN-3：形状必须与 config schema 一致）
  export interface AgentStyleConfig { id?: string; path?: string; overrides?: Record<string, string> }
  // AgentConfig 加：style?: AgentStyleConfig
  // AgentContext 加：style?: StyleTemplate   ← Task 4 的 runtime 回填；Task 1 类型 import
  ```

- [ ] **Step 1: 写失败测试**

`packages/config/src/__tests__/agent-schema.test.ts` 追加（沿用该文件既有 describe 风格）：

```ts
describe('agent.style', () => {
  it('accepts id / path / overrides forms', () => {
    expect(ConfigSchema.safeParse({ agent: { style: { id: 'tailwind-lite' } } }).success).toBe(true)
    expect(ConfigSchema.safeParse({ agent: { style: { path: './styles/my.md' } } }).success).toBe(true)
    expect(ConfigSchema.safeParse({ agent: { style: { id: 'x', overrides: { color: '蓝' } } } }).success).toBe(true)
    expect(ConfigSchema.safeParse({ agent: { style: {} } }).success).toBe(true) // 空 = auto-detect
  })

  it('rejects unknown keys (strict) and wrong types', () => {
    expect(ConfigSchema.safeParse({ agent: { style: { template: 'x' } } }).success).toBe(false)
    expect(ConfigSchema.safeParse({ agent: { style: { id: '' } } }).success).toBe(false)
    expect(ConfigSchema.safeParse({ agent: { style: { overrides: { a: 1 } } } }).success).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @nx-mk/config exec vitest run src/__tests__/agent-schema.test.ts`
Expected: FAIL（AgentConfigSchema 不识别 style → safeParse 对 style 键剥离后 success 仍为 true 的话，看 unknown-key 用例必 false 才对——`{ template: 'x' }` 被 strip 后 success=true，测试失败）

- [ ] **Step 3: 实现 schema**

`packages/config/src/schema.ts` 在 `AgentLoopConfigSchema` 之后插入：

```ts
// 风格模板选择段（spec 2026-10-02 §2.2）：内置 id 或自定义 markdown path；strict 拒未知键。
// 语义校验（未知 id / 文件存在性）归 @nx-mk/agent loadStyleTemplate 启动期 fail-fast —— schema 只管形状。
export const AgentStyleConfigSchema = z
  .object({
    id: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    overrides: z.record(z.string()).optional(),
  })
  .strict()
export type AgentStyleConfig = z.infer<typeof AgentStyleConfigSchema>
```

`AgentConfigSchema` 加一行：

```ts
export const AgentConfigSchema = z.object({
  provider: AgentProviderConfigSchema.optional(),
  loop: AgentLoopConfigSchema.optional(),
  style: AgentStyleConfigSchema.optional(),   // 风格模板选择（spec §2.6 接线 1）
  // C8：builtin agent 白名单（名字组参考 @nx-mk/agent builtinAgentFactories）；
  // 未知名在 CLI 装配层报 CONFIG_INVALID —— schema 层只校验形状（非空字符串）。
  agents: z.array(z.string().min(1)).optional(),
})
```

- [ ] **Step 4: agent 侧镜像类型**

`packages/agent/src/types.ts`——`AgentConfig` 与 `AgentContext` 两处：

```ts
// types.ts 顶部 import 区加：
import type { StyleTemplate } from './style/types.js'

// AgentConfig 加（保持 PLN-3 镜像注释）：
export interface AgentConfig {
  provider?: AgentProviderConfig
  loop?: AgentLoopConfig
  style?: AgentStyleConfig             // 风格模板选择（镜像 config AgentStyleConfigSchema）
  agents?: string[]                    // C8：builtin 白名单（CLI 装配层消费；review-agent 不可选）
}
// 并在 AgentLoopConfig 之后加镜像接口：
export interface AgentStyleConfig { id?: string; path?: string; overrides?: Record<string, string> }

// AgentContext 加可选字段（runtime 启动期回填；不配置 = undefined → prompt/G5 全部现网行为）：
export interface AgentContext {
  report: CoverageReport      // 只读输入（@nx-mk/coverage 类型直用）
  manifestSummary: string     // R8
  policySummary: string       // R8
  projectRoot: string         // nx-mk.config.yml 所在目录（claude cwd / git apply cwd）
  ai: AgentProvider
  log: (msg: string) => void
  style?: StyleTemplate       // 风格模板（spec §2.4/§2.5：prompt 注入 + G5 共用；undefined = 关闭）
}
```

`packages/agent/src/index.ts` 的 types 出口块加 `type AgentStyleConfig`。

**CLI 接线说明（spec §2.6 三处接线之二）**：`packages/cli/src/commands/loop.ts` 的既有 cast
`(config as ... & { agent?: AgentConfig }).agent` 加 mergedCfg 展开会**自动透传 style**（schema
解析后 style 已在 agent 段内）——CLI **零代码改动**，由本 task 的 schema 测试 + Task 6 全仓
`pnpm -r build && npx vitest run` 回归覆盖，不新增 cli 用例。

- [ ] **Step 5: 跑测试 + typecheck + Commit**

Run: `pnpm --filter @nx-mk/config exec vitest run src/__tests__/agent-schema.test.ts && pnpm --filter @nx-mk/agent typecheck && pnpm --filter @nx-mk/config typecheck`
Expected: 全绿

```bash
git add packages/config/src/schema.ts packages/config/src/__tests__/agent-schema.test.ts packages/agent/src/types.ts packages/agent/src/index.ts
git commit -m "feat(config,agent): agent.style 段 schema + AgentContext.style 通道（spec §2.6）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: prompt 注入（buildPrompt 第三参 + runtime 回填）

**Files:**
- Modify: `packages/agent/src/agents/api-ui.ts`（`buildPrompt` 加 `style` 参；`applyTasks` 传 `ctx.style`）
- Modify: `packages/agent/src/runtime.ts`（启动期 `loadStyleTemplate` fail-fast + 回填 ctx）
- Test: `packages/agent/src/__tests__/api-ui.test.ts`（追加）
- Test: `packages/agent/src/__tests__/runtime-loop.test.ts`（追加 fail-fast 用例）

**Interfaces:**
- Consumes: Task 2 `loadStyleTemplate`；Task 3 `AgentContext.style`
- Produces:
  ```ts
  // api-ui.ts 新签名（第三参可选 —— 现有双参调用编译期兼容）
  export function buildPrompt(task: AgentTask & { type: 'render-field' }, ctx: AgentContext, style?: StyleTemplate): string
  // 渲染规则（spec §2.4）：style 缺省 或 id === 'auto-detect' → 不渲染风格段（逐字节兼容）；
  // 否则在 'Hard constraints:' 之前插入：
  //   Style guidelines (template: <id>):
  //   <description>
  //
  //   Hard rules:
  //   - <rule>
  ```

- [ ] **Step 1: 写失败测试（api-ui.test.ts 追加）**

```ts
import { buildPrompt } from '../agents/api-ui.js'   // 若文件头已 import 则跳过
import type { StyleTemplate } from '../style/types.js'

const STYLE: StyleTemplate = {
  id: 'tailwind-lite',
  source: 'built-in',
  classNameWhitelist: ['flex', 'px-*'],
  description: 'Utility-first Tailwind styling.',
  rules: ['Use Tailwind utility classes for all styling.', 'Never use inline style attributes.'],
}

describe('buildPrompt style section (spec §2.4)', () => {
  const ctx = makeCtx()

  const taskOf = async () => (await planTasks(ctx)).tasks[0] as Parameters<typeof buildPrompt>[0]

  it('byte-identical output when style is undefined (DS3 compat anchor)', async () => {
    const task = await taskOf()
    expect(buildPrompt(task, ctx)).toBe(buildPrompt(task, ctx, undefined))
  })

  it('injects the style section between task line and Hard constraints', async () => {
    const p = buildPrompt(await taskOf(), ctx, STYLE)
    const taskIdx = p.indexOf('Task: make the API field')
    const styleIdx = p.indexOf('Style guidelines (template: tailwind-lite):')
    const hardIdx = p.indexOf('Hard constraints:')
    expect(styleIdx).toBeGreaterThan(taskIdx)
    expect(styleIdx).toBeLessThan(hardIdx)
    expect(p).toContain('Utility-first Tailwind styling.')
    expect(p).toContain('- Use Tailwind utility classes for all styling.')
    expect(p).toContain('- Never use inline style attributes.')
  })

  it('auto-detect id renders NO style section (spec §2.4)', async () => {
    const task = await taskOf()
    const p = buildPrompt(task, ctx, { ...STYLE, id: 'auto-detect', description: '', rules: [] })
    expect(p).not.toContain('Style guidelines')
    expect(p).toBe(buildPrompt(task, ctx))
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @nx-mk/agent exec vitest run src/__tests__/api-ui.test.ts`
Expected: FAIL（buildPrompt 只收两参——TS 编译错误或新用例红）

- [ ] **Step 3: 实现 buildPrompt 扩展**

`packages/agent/src/agents/api-ui.ts` 改动（保持原数组顺序，风格段插在空行后、Hard constraints 前）：

```ts
import type { StyleTemplate } from '../style/types.js'

// prompt 组装（spec §3.5）：§44.4 硬约束 + 风格段（§2.4）+ 字段上下文 + manifestSummary + policySummary
// 风格段渲染规则（spec §2.4/DS3）：style 缺省或 id==='auto-detect' → 不渲染（逐字节兼容现网）
export function buildPrompt(task: AgentTask & { type: 'render-field' }, ctx: AgentContext, style?: StyleTemplate): string {
  const endpoint = task.endpointId ?? 'unknown endpoint'
  const head = [
    'You are improving API/UI coverage of a frontend project.',
    `Task: make the API field "${task.fieldPath}" (endpoint: ${endpoint}) visibly rendered in the UI, so the coverage analyzer can observe real evidence.`,
    '',
  ]
  if (style && style.id !== 'auto-detect') {
    head.push(
      `Style guidelines (template: ${style.id}):`,
      style.description,
      '',
      'Hard rules:',
      ...style.rules.map((r) => `- ${r}`),
      '',
    )
  }
  return [
    ...head,
    'Hard constraints:',
    '- Never render fields that the policy marks as ignored.',
    '- Never dump a response object with JSON.stringify as a substitute for real UI rendering.',
    '- Never add console.log probes for fields or coverage.',
    `- Add data-mk-field="${task.fieldId}" to the element(s) that render the field, so evidence collection can observe it.`,
    '',
    ctx.manifestSummary,
    '',
    ctx.policySummary,
    '',
    'Output exactly one fenced ```diff code block containing a unified diff (git format). No explanations outside the block.',
  ].join('\n')
}
```

`applyTasks` 里唯一一处调用改为：

```ts
const out = await ctx.ai.edit({
  instructions: buildPrompt(task, ctx, ctx.style),
  context: { /* 原样不动 */ },
})
```

- [ ] **Step 4: 实现 runtime 回填（fail-fast 在任何 fs 写之前）**

`packages/agent/src/runtime.ts`：

```ts
import { loadStyleTemplate } from './style/loader.js'
import type { StyleTemplate } from './style/types.js'

// runAgentLoop 内，resolveAgentConfig 之后、.nx-mk 目录准备（mkdirSync）之前：
export async function runAgentLoop(opts: LoopOptions, deps: LoopDeps): Promise<LoopSummary> {
  const log = opts.log ?? (() => {})
  const cfg = resolveAgentConfig(opts.config)
  // 风格模板启动期解析（spec §3：进程级 fail-fast —— config 错误不烧 LLM 轮次、不落任何 run 产物）。
  // DS3 关键：仅在 id 或 path **显式配置**时回填 ctx.style —— 未配置必须保持 undefined，
  // 否则 G5 会对未配置用户生效（宿主扫描可能拒绝其合法 patch），破坏现网兼容铁律。
  // （loader 对 undefined 返回 auto-detect 对象是 loader 层语义；runtime 在此门控。）
  const style: StyleTemplate | undefined =
    opts.config.style?.id || opts.config.style?.path
      ? loadStyleTemplate(opts.config.style, { projectRoot: opts.projectRoot, log })
      : undefined
  const agentRunId = makeAgentRunId()
  // ...（原样）mkdir/openCoverageDb ...

  const ctx: AgentContext = {
    report: opts.report,
    manifestSummary: renderManifestSummary(opts.report),
    policySummary: renderPolicySummary(opts.report),
    projectRoot: opts.projectRoot,
    ai: deps.provider,
    log,
    style,   // ← 新增（Task 3 的通道；Task 5 的 review guard 同读此字段；undefined = 完全现网行为）
  }
```

- [ ] **Step 5: 追加 runtime fail-fast 测试（runtime-loop.test.ts）**

```ts
describe('style fail-fast (spec §3)', () => {
  it('unknown style id aborts the loop before any .nx-mk artifact is created', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nx-mk-style-fastfail-'))   // 该文件若已有 tmpdir import 则复用
    try {
      await expect(runAgentLoop(
        { projectRoot: root, report: makeReport(), config: { style: { id: 'nope' } } },
        makeDeps(),   // 该文件既有的 deps 构造 helper；名字不同则以文件内为准
      )).rejects.toThrow(/nope/)
      expect(existsSync(join(root, '.nx-mk'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
```

> 实现注意：`makeReport` / deps helper / tmp 目录清理写法以 `runtime-loop.test.ts` 文件内既有模式为准（该文件已有多处 tmp 根 + LoopDeps 构造）；新用例复用它们，勿新造平行 helper。

- [ ] **Step 6: 跑测试 + 全包回归 + Commit**

Run: `pnpm --filter @nx-mk/agent exec vitest run && pnpm --filter @nx-mk/agent typecheck`
Expected: 全绿（现有 api-ui/runtime 用例不破 = DS3 兼容锚实证）

```bash
git add packages/agent/src
git commit -m "feat(agent): buildPrompt 风格段注入 + runtime 启动期 style 解析 fail-fast（spec §2.4/§3）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: review guard G5（className 白名单 + 宿主扫描兜底）

**Files:**
- Create: `packages/agent/src/style/guard-classname.ts`
- Create: `packages/agent/src/style/host-classes.ts`
- Modify: `packages/agent/src/agents/review.ts`（G5 并入检查链）
- Test: `packages/agent/src/style/__tests__/guard-classname.test.ts`（新建）
- Test: `packages/agent/src/__tests__/review.test.ts`（追加 G5 用例）

> `guard-classname.ts` / `host-classes.ts` 是 review.ts 的**内部依赖**（相对路径 import），不进
> `index-pub.ts` 公开出口——公开面最小化；G5 行为经 review.ts 的公开 `verifyDiff` 出口被测试覆盖。

**Interfaces:**
- Consumes: Task 1 `StyleTemplate`；review.ts 既有 `addedLines` / `verifyDiff` / `inject` 缝
- Produces:
  ```ts
  // style/guard-classname.ts
  export function extractClassTokens(line: string): string[]
  // 识别 class="a b" / className="a b" / className={'a b'}；动态表达式（styles.foo / 模板字符串）返回 []
  export function whitelistMatches(token: string, whitelist: string[]): boolean
  // 'px-*' → /^px-.*$/；无 '*' 的项全词相等
  export function checkClassNames(tokens: string[], template: StyleTemplate, hostClasses: Set<string>): string[]
  // 返回违规 token（去重、保序）；判定序（spec §2.5）：白名单命中 → 宿主集合命中 → 违规

  // style/host-classes.ts
  export function collectHostClasses(projectRoot: string): Set<string>
  // readdirSync recursive 扫 .css/.scss/.tsx/.jsx；跳过 node_modules/.git/dist/.nx-mk/build；
  // CSS 提取 .class 选择器 + 模板提取 class/className 字符串；模块级 Map<projectRoot, Set> 缓存
  ```
  ```ts
  // review.ts：verifyDiff 的 inject 类型扩展（向后兼容，只加可选键）
  inject?: { applyCheck?: ApplyCheckFn; hostClasses?: Set<string> }
  // G5 规则（spec §2.5）：仅当 ctx.style 存在时运行；未配置 → 不 push 任何 check 条目（DS3 兼容）
  ```

- [ ] **Step 1: 写失败测试（guard-classname.test.ts）**

```ts
/**
 * G5 className guard 纯函数单测（spec §2.5）：
 * token 提取（含 CRLF / 动态表达式跳过）、通配白名单、宿主兜底、violation 汇总。
 */
import { describe, it, expect } from 'vitest'
import { extractClassTokens, whitelistMatches, checkClassNames } from '../guard-classname.js'
import type { StyleTemplate } from '../types.js'

const TPL: StyleTemplate = {
  id: 'tailwind-lite', source: 'built-in',
  classNameWhitelist: ['flex', 'px-*', 'text-sm'],
  description: 'd', rules: ['r'],
}

describe('extractClassTokens', () => {
  it('extracts static class and className strings (space-separated)', () => {
    expect(extractClassTokens(`+    <div className="flex items-center px-4">`)).toEqual(['flex', 'items-center', 'px-4'])
    expect(extractClassTokens(`+    <p class="muted">x</p>`)).toEqual(['muted'])
    expect(extractClassTokens(`+    <div className={'flex grid'}>`)).toEqual(['flex', 'grid'])
  })

  it('tolerates trailing CRLF on diff lines (Review Focus #1)', () => {
    expect(extractClassTokens(`+    <div className="flex">\r`)).toEqual(['flex'])
  })

  it('skips dynamic expressions (styles.foo, template literals) — never false-positives', () => {
    expect(extractClassTokens(`+    <div className={styles.panel}>`)).toEqual([])
    expect(extractClassTokens('+    <div className={`flex ${x}`}>')).toEqual([])
    expect(extractClassTokens('+    plain line without class')).toEqual([])
  })
})

describe('whitelistMatches', () => {
  it('exact match without wildcard; prefix match with trailing *', () => {
    expect(whitelistMatches('flex', TPL.classNameWhitelist!)).toBe(true)
    expect(whitelistMatches('px-4', TPL.classNameWhitelist!)).toBe(true)   // px-*
    expect(whitelistMatches('px', TPL.classNameWhitelist!)).toBe(false)
    expect(whitelistMatches('py-3', TPL.classNameWhitelist!)).toBe(false)
    expect(whitelistMatches('text-sm', TPL.classNameWhitelist!)).toBe(true)
  })
})

describe('checkClassNames', () => {
  it('passes tokens hitting whitelist or host set; returns deduped violations otherwise', () => {
    const host = new Set(['muted'])
    expect(checkClassNames(['flex', 'px-4', 'muted'], TPL, host)).toEqual([])
    expect(checkClassNames(['evil-card', 'evil-card', 'px-4'], TPL, host)).toEqual(['evil-card'])
  })

  it('no whitelist → host set is the only oracle (auto-detect semantics)', () => {
    const t: StyleTemplate = { id: 'semantic-css', source: 'built-in', description: 'd', rules: ['r'] }
    expect(checkClassNames(['muted', 'brand'], t, new Set(['muted']))).toEqual(['brand'])
  })

  it('empty host set → violations still reported (caller adds the zero-hit hint)', () => {
    expect(checkClassNames(['muted'], TPL, new Set())).toEqual(['muted'])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @nx-mk/agent exec vitest run src/style/__tests__/guard-classname.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 guard-classname.ts**

```ts
/**
 * G5 className guard 纯函数（spec §2.5）。
 * 判定序：模板白名单（通配）→ 宿主类集合 → violation。动态表达式跳过（宁可漏检不误杀）。
 */
import type { StyleTemplate } from './types.js'

const CLASS_ATTR = /(?:className|class)=("([^"]*)"|\{(['"])([^'"]*)\3\})/g

// 单行 → class token 列表；动态表达式（{styles.x}、模板字符串）返回 []（Review Focus #2）
export function extractClassTokens(line: string): string[] {
  const clean = line.replace(/\r$/, '')
  const tokens: string[] = []
  for (const m of clean.matchAll(CLASS_ATTR)) {
    const raw = m[2] ?? m[4] ?? ''
    if (!m[2] && raw.includes('${')) continue // 模板字符串字面量形态，跳过
    for (const t of raw.split(/\s+/)) if (t) tokens.push(t)
  }
  return tokens
}

// 'px-*' → 前缀通配；其余全词相等
export function whitelistMatches(token: string, whitelist: string[]): boolean {
  return whitelist.some((w) =>
    w.endsWith('*') ? token.startsWith(w.slice(0, -1)) : token === w,
  )
}

// 违规 token（去重保序）。判定序（spec §2.5）：白名单命中 **或** 宿主命中 → 放行；两者皆未命中 → violation
export function checkClassNames(tokens: string[], template: StyleTemplate, hostClasses: Set<string>): string[] {
  const wl = template.classNameWhitelist
  const seen = new Set<string>()
  const violations: string[] = []
  for (const t of tokens) {
    if (seen.has(t)) continue
    seen.add(t)
    const ok = (wl !== undefined && whitelistMatches(t, wl)) || hostClasses.has(t)
    if (!ok) violations.push(t)
  }
  return violations
}
```

- [ ] **Step 4: 实现 host-classes.ts**

```ts
/**
 * 宿主既有 class 集合扫描（spec §2.5 G5 兜底）—— node:fs 递归，无新 glob 依赖。
 * 模块级按 projectRoot 缓存：一次 loop 多 task 复用；测试经 review.ts inject.hostClasses 注入替身。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SCANNABLE = new Set(['.css', '.scss', '.tsx', '.jsx'])
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-ui', 'build', '.nx-mk', 'coverage'])
const CSS_CLASS = /\.([a-zA-Z_-][\w-]*)/g
const ATTR_CLASS = /(?:className|class)=["']([^"']+)["']/g

const cache = new Map<string, Set<string>>()

function walkFiles(dir: string, out: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return // 不可读目录静默跳过（G5 是辅助 guard，不因扫描失败炸 loop）
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) walkFiles(p, out)
    else if (SCANNABLE.has(name.slice(name.lastIndexOf('.')).toLowerCase())) out.push(p)
  }
}

export function collectHostClasses(projectRoot: string): Set<string> {
  const hit = cache.get(projectRoot)
  if (hit) return hit
  const files: string[] = []
  walkFiles(projectRoot, files)
  const classes = new Set<string>()
  for (const f of files) {
    let text: string
    try {
      text = readFileSync(f, 'utf8')
    } catch {
      continue
    }
    const isStyle = /\.(css|scss)$/.test(f)
    for (const m of text.matchAll(isStyle ? CSS_CLASS : ATTR_CLASS)) {
      const raw = m[1]!
      for (const t of raw.split(/\s+/)) if (t) classes.add(t)
    }
  }
  cache.set(projectRoot, classes)
  return classes
}
```

- [ ] **Step 5: review.ts 并入 G5**

`packages/agent/src/agents/review.ts` 三处改动：

```ts
// ① import 区
import { checkClassNames } from '../style/guard-classname.js'
import { collectHostClasses } from '../style/host-classes.js'

// ② verifyDiff 签名的 inject 扩展（只加可选键，既有调用不变）
export async function verifyDiff(
  ctx: AgentContext,
  result: AgentApplyResult,
  inject?: { applyCheck?: ApplyCheckFn; hostClasses?: Set<string> },
): Promise<AgentVerifyResult> {

// ③ G4 之后、for 循环收尾之前（同层级）：
    // G5：classname-whitelist（spec §2.5）—— 仅 ctx.style 存在时运行；未配置不产生 check 条目（DS3 兼容）
    if (ctx.style) {
      const host = inject?.hostClasses ?? collectHostClasses(ctx.projectRoot)
      const tokens = lines.flatMap((l) => extractClassTokens(l))
      const violations = checkClassNames(tokens, ctx.style, host)
      if (violations.length > 0) {
        const hint = host.size === 0 ? '（宿主未检出任何既有 class —— 全新项目或扫描路径有误）' : ''
        reject(
          'classname-whitelist',
          `class tokens not allowed by style template "${ctx.style.id}": ${violations.join(', ')}${hint}`,
        )
      } else {
        checks.push({ name: 'classname-whitelist', outcome: 'pass' })
      }
    }
```

（`extractClassTokens` 需一并 import：`import { checkClassNames, extractClassTokens } from '../style/guard-classname.js'`。）

- [ ] **Step 6: review.test.ts 追加 G5 行为用例**

```ts
import type { StyleTemplate } from '../types.js'

const STYLE: StyleTemplate = {
  id: 'tailwind-lite', source: 'built-in', classNameWhitelist: ['flex', 'px-*'],
  description: 'd', rules: ['r'],
}

function ctxWithStyle(base: AgentContext, style?: StyleTemplate): AgentContext {
  return { ...base, style }
}

const PATCH_WITH_FLEX: AgentApplyResult = {
  results: [{
    task: { type: 'render-field', fieldId: 'f1', fieldPath: 'data.name', endpointId: null, reason: 'r' },
    status: 'diff-produced',
    diffText: ['--- a/app/src/A.tsx', '+++ b/app/src/A.tsx', '@@ -1,1 +1,2 @@',
      '+<div className="flex px-4" data-mk-field="f1">x</div>'].join('\n'),
    patchRelPath: '.nx-mk/patches/run/f1.patch',
  }],
}

describe('G5 classname-whitelist (spec §2.5)', () => {
  it('no ctx.style → no classname-whitelist check entry at all (DS3 compat)', async () => {
    const vr = await verifyDiff(makeCtx(), PATCH_WITH_FLEX, { applyCheck: async () => 'pass', hostClasses: new Set() })
    expect(vr.checks.some((c) => c.name === 'classname-whitelist')).toBe(false)
    expect(vr.verdict).toBe('pass')
  })

  it('tokens hitting the whitelist pass with an explicit pass entry', async () => {
    const vr = await verifyDiff(ctxWithStyle(makeCtx(), STYLE), PATCH_WITH_FLEX, { applyCheck: async () => 'pass', hostClasses: new Set() })
    expect(vr.checks.find((c) => c.name === 'classname-whitelist')?.outcome).toBe('pass')
    expect(vr.verdict).toBe('pass')
  })

  it('off-whitelist token → reject with token list; empty host set adds the hint', async () => {
    const patch: AgentApplyResult = {
      results: [{
        task: { type: 'render-field', fieldId: 'f1', fieldPath: 'data.name', endpointId: null, reason: 'r' },
        status: 'diff-produced',
        diffText: ['--- a/a.tsx', '+++ b/a.tsx', '@@',
          '+<div className="evil-card" data-mk-field="f1">x</div>'].join('\n'),
        patchRelPath: '.nx-mk/patches/run/f1.patch',
      }],
    }
    const vr = await verifyDiff(ctxWithStyle(makeCtx(), STYLE), patch, { applyCheck: async () => 'pass', hostClasses: new Set() })
    expect(vr.verdict).toBe('reject')
    const g5 = vr.checks.find((c) => c.name === 'classname-whitelist')!
    expect(g5.outcome).toBe('reject')
    expect(g5.detail).toContain('evil-card')
    expect(g5.detail).toContain('宿主未检出')
  })

  it('no whitelist (semantic-css) → host set is the oracle', async () => {
    const t: StyleTemplate = { id: 'semantic-css', source: 'built-in', description: 'd', rules: ['r'] }
    const vr = await verifyDiff(ctxWithStyle(makeCtx(), t), PATCH_WITH_FLEX, { applyCheck: async () => 'pass', hostClasses: new Set(['flex', 'px-4']) })
    expect(vr.verdict).toBe('pass')
  })
})
```

- [ ] **Step 7: 全量回归 + typecheck + Commit**

Run: `pnpm --filter @nx-mk/agent exec vitest run && pnpm --filter @nx-mk/agent typecheck`
Expected: 全绿（既有 G1-G4 用例不破）

```bash
git add packages/agent/src
git commit -m "feat(agent): review guard G5 —— className 白名单 + 宿主扫描兜底（spec §2.5）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: 文档 + 全仓验证收口

**Files:**
- Create: `docs/style-templates.md`
- Modify: `README.md`（agent 配置示例区追加 `style:` 示例，见 Step 2 定位）

**Interfaces:**
- Consumes: 全部前序任务（文档只描述已实现行为）
- Produces: 无代码接口；验收 = 全仓绿基线

- [ ] **Step 1: 写 docs/style-templates.md（模板作者指南）**

内容框架（全文写出，不留 TBD）：

```markdown
# nx-mk 风格模板指南（agent.style）

`agent.style` 让 api-ui-agent 产出的前端补丁遵循确定风格：模板注入 prompt，review guard
G5 按 className 白名单校验。不配置 = 现网行为（无风格段、G5 关闭）。

## 配置

​```yaml
agent:
  style:
    id: tailwind-lite            # 内置：tailwind-lite / semantic-css / mui-style / unstyled / auto-detect
    # path: ./styles/my-corp.md  # 自定义模板（相对 nx-mk.config.yml；与 id 同给时 path 优先）
    # overrides:
    #   color: 蓝                # description 里 {{color}} 占位符插值
​```

## 模板格式（三段式契约）

​```md
---
id: my-corp-style                          # 可选；缺省取文件名 stem
classNameWhitelist: ["flex", "px-*"]       # 可选；G5 白名单，* 为尾部通配
---
风格概述（1-3 句，原样进 prompt；支持 {{key}} 占位符）。

## Hard rules                              # 必需；每条列表项原样进 prompt
- 规则一
- 规则二
​```

缺 frontmatter / 缺 `## Hard rules` / 描述为空 → `nx-mk loop` 启动即失败并列出修复示例
（config 语义错误不烧 LLM 轮次）。

## G5 判定序

1. 模板带 `classNameWhitelist` → patch 新增行里的 class token 按白名单匹配（`px-*` 前缀通配）；
2. 未带白名单（或显式 auto-detect）→ 扫描宿主项目 css/scss/tsx/jsx 的既有 class，命中即放行；
3. 均未命中 → patch 进 `.nx-mk/patches/<runId>/rejected/`，detail 列出违规 token。

动态 className（`styles.foo`、模板字符串）不参与判定。空 classNode 与宿主零命中场景
guard 会给出可读提示。

## 内置模板一览

| id | 定位 | 白名单 |
|---|---|---|
| tailwind-lite | utility-first，禁自定义 CSS | 有（尾部通配集合） |
| semantic-css | 复用宿主语义 class | 无（宿主扫描） |
| mui-style | MUI 组件 + sx prop | 无（宿主扫描） |
| unstyled | 纯结构渲染 | 无（宿主扫描） |
| auto-detect | 默认兜底，不渲染 prompt 段 | 无（宿主扫描） |
```

- [ ] **Step 2: README 追加配置示例**

在 README.md 的 agent/loop 相关章节（搜 `claude` CLI 前置说明那段，约 L148 前后），其后追加一小节：

```markdown
### agent.style：前端补丁风格模板

​```yaml
agent:
  style:
    id: tailwind-lite   # 或 path: ./styles/my-corp.md（自定义 markdown 模板）
​```

模板格式、内置清单与 G5 className 校验行为见 [`docs/style-templates.md`](./docs/style-templates.md)。
```

- [ ] **Step 3: 全仓验证收口**

```bash
pnpm -r build          # 记忆约定：验证前先全量构建（stale dist 防线）
pnpm typecheck         # 13 包全绿
npx vitest run         # 基线 765 + 本计划净增（约 +25）；0 fail
```

Expected: 三条全绿。测试计数只增不减。

- [ ] **Step 4: Commit**

```bash
git add docs/style-templates.md README.md
git commit -m "docs(style): 风格模板作者指南 + README 配置示例（spec §5）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

- [ ] **Step 5: 收尾——推送 + PR**

```bash
git push -u origin feat/agent-style-templates
```

PR 按仓库惯例走 `gh api` REST 创建（记忆：`gh pr create` 在本仓无 upstream remote 会失败，用 REST；PR 描述结尾加 `🤖 Generated with [Claude Code](https://claude.com/claude-code)`）。合并纪律（记忆）：确认 MERGED 状态后才删分支。
