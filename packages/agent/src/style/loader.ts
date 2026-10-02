/**
 * 风格模板 loader（spec 2026-10-02 §2.2 契约 + §3 错误路径）。
 * parseStyleMarkdown：markdown 契约文本 → StyleTemplate（纯函数）。
 * loadStyleTemplate / 内置注册表见本文件后半（Task 2）。
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
