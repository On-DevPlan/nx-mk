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

// ---- Task 2：loadStyleTemplate / 内置注册表（spec §2.3/§3） ----
import { loadStyleTemplate, BUILTIN_STYLE_IDS } from '../style/loader.js'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'

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

  it('tailwind-lite ships a classNameWhitelist; the other named four do not', () => {
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
    const p = join(tmpRoot, 'my style 模板.md') // Review Focus #4：中文 + 空格路径
    writeFileSync(p, '---\nid: custom-one\n---\n自定义描述。\n\n## Hard rules\n- 自定义规则\n')
    warnings.length = 0
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
