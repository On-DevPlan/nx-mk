/**
 * 风格模板 loader（spec 2026-10-02 §2.2 契约 + §3 错误路径）。
 * parseStyleMarkdown：markdown 契约文本 → StyleTemplate（纯函数）。
 * loadStyleTemplate / 内置注册表见本文件后半（Task 2）。
 */
import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { KernelError } from '@nx-mk/kernel'
import { tailwindLiteTemplate } from './templates/tailwind-lite.js'
import { semanticCssTemplate } from './templates/semantic-css.js'
import { muiStyleTemplate } from './templates/mui-style.js'
import { unstyledTemplate } from './templates/unstyled.js'
import type { StyleConfigInput, StyleTemplate } from './types.js'

// style 专用错误别名：config 语义错误统一 CONFIG_INVALID（spec §3 fail-fast）
export class StyleTemplateError extends KernelError {
  constructor(message: string) {
    super('CONFIG_INVALID', message, null)
  }
}

// 闭合 --- 前的换行可选：空 frontmatter（'---\n---'）也要能匹配
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n?---(?:\r?\n|$)([\s\S]*)$/
const HARD_RULES_HEADING = /^##\s+Hard rules\s*$/m

// markdown 契约（spec §2.2）：frontmatter(id?/classNameWhitelist?) + 描述正文 + '## Hard rules' 列表
export function parseStyleMarkdown(text: string, source: 'built-in' | 'custom', fallbackId: string): StyleTemplate {
  const m = FRONTMATTER.exec(text)
  if (!m) {
    throw new StyleTemplateError(
      'style template must start with YAML frontmatter (--- ... ---). 模板格式：\n---\nid: my-style\nclassNameWhitelist: ["flex"]\n---\n描述正文。\n\n## Hard rules\n- 规则',
    )
  }
  let meta: Record<string, unknown>
  try {
    meta = (parseYaml(m[1] ?? '') ?? {}) as Record<string, unknown>
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

// ---------------------------------------------------------------------
// 内置注册表 + loadStyleTemplate（spec §2.3/§3）
// ---------------------------------------------------------------------

// 4 个 markdown 契约模板（经同一解析器走查，契约即范例）+ auto-detect 字面对象
// （DS3：不渲染 prompt 段，G5 按白名单缺省语义走宿主扫描）。
const BUILTIN_TEMPLATES: Record<string, StyleTemplate> = {
  'tailwind-lite': parseStyleMarkdown(tailwindLiteTemplate, 'built-in', 'tailwind-lite'),
  'semantic-css': parseStyleMarkdown(semanticCssTemplate, 'built-in', 'semantic-css'),
  'mui-style': parseStyleMarkdown(muiStyleTemplate, 'built-in', 'mui-style'),
  unstyled: parseStyleMarkdown(unstyledTemplate, 'built-in', 'unstyled'),
  'auto-detect': { id: 'auto-detect', source: 'built-in', description: '', rules: [] },
}

export const BUILTIN_STYLE_IDS: readonly string[] = Object.keys(BUILTIN_TEMPLATES)

const PLACEHOLDER = /\{\{(\w+)\}\}/g

// 解析优先级（spec §2.2）：path > id > auto-detect；语义错误全部 StyleTemplateError（§3 fail-fast）
export function loadStyleTemplate(
  cfg: StyleConfigInput | undefined,
  opts?: { projectRoot?: string; log?: (msg: string) => void },
): StyleTemplate {
  const log = opts?.log ?? (() => {})

  // 未配置 / 空配置 → auto-detect 字面对象（调用方 runtime 对「未显式配置」回填 undefined —— DS3）
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
    // path 模式 id 以 frontmatter id（缺省 stem）为准；cfg.id 不参与覆盖（仅触发 path-wins 警告）
    const stem = cfg.path.replace(/\\/g, '/').split('/').pop()!.replace(/\.md$/i, '')
    template = { ...parseStyleMarkdown(text, 'custom', stem) }
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
