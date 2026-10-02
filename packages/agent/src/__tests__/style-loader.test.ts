/**
 * style loader 单测（spec §2.2 契约 + §3 错误路径）：parseStyleMarkdown 纯函数部分。
 * 位置 ruling：根 vitest include 只收 src/__tests__ 平铺 —— style 测试按仓库约定放这里。
 * Task 2 追加 loadStyleTemplate 注册表 / 优先级 / overrides 用例。
 */
import { describe, it, expect } from 'vitest'
import { parseStyleMarkdown, StyleTemplateError } from '../style/loader.js'

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
