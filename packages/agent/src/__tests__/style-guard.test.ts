/**
 * G5 className guard 纯函数单测（spec 2026-10-02 §2.5）：
 * token 提取（含 CRLF / 动态表达式跳过）、通配白名单、宿主兜底、violation 汇总。
 * review.ts 集成行为在 review.test.ts 的 G5 describe 覆盖。
 */
import { describe, it, expect } from 'vitest'
import { extractClassTokens, whitelistMatches, checkClassNames } from '../style/guard-classname.js'
import type { StyleTemplate } from '../style/types.js'

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
    expect(whitelistMatches('px-4', TPL.classNameWhitelist!)).toBe(true) // px-*
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
