/**
 * 有限通配匹配（spec §3.2）：按 '.' 分段；* 匹配单段；** 匹配零或多段；其余字面全等。
 * 这是 policy-engine 的地基 —— 语义矩阵在此钉死，kernel 侧镜像实现靠跨包契约测试对齐（Task 3）。
 *
 * ── 跨包契约矩阵（Task 3 preflight ruling）──
 * 下方 GLOB_MATRIX 与 packages/kernel/src/__tests__/initial-coverage.test.ts 的同名矩阵
 * 逐三元组一致；矩阵改动须双侧同步（kernel 内置镜像 matcher 不 import coverage，
 * 契约以两侧行为矩阵互指钉住语义全等）。
 */
import { describe, it, expect } from 'vitest'
import { matchGlob } from '../src/policy/index.js'

// 跨包契约矩阵：字面 / * / ** / 混合各含正反例，共 10 组三元组。
// 与 packages/kernel/src/__tests__/initial-coverage.test.ts 的同名矩阵逐三元组一致，
// 矩阵改动须双侧同步（见文件头注释）。
const GLOB_MATRIX: ReadonlyArray<{ pattern: string; path: string; expected: boolean }> = [
  // 字面段全等（正/反/前缀不算段全等）
  { pattern: 'data.user.id', path: 'data.user.id', expected: true },
  { pattern: 'data.user.id', path: 'data.user.name', expected: false },
  { pattern: 'data.user', path: 'data.user.id', expected: false },
  // * 恰好一段（正/反/不匹配零段）
  { pattern: 'data.*.city', path: 'data.address.city', expected: true },
  { pattern: 'data.*.city', path: 'data.a.b.city', expected: false },
  { pattern: '*.metadata.*', path: 'data.metadata', expected: false },
  // ** 零或多段（正/反）
  { pattern: '**.internalRiskScore', path: 'data.internalRiskScore', expected: true },
  { pattern: '**.internalRiskScore', path: 'data.name', expected: false },
  // 混合（正/反：段全等而非前缀）
  { pattern: 'data.**.id', path: 'data.user.profile.id', expected: true },
  { pattern: 'data.**', path: 'database.x', expected: false },
]

describe('matchGlob', () => {
  it('字面 pattern 精确全等', () => {
    expect(matchGlob('data.user.id', 'data.user.id')).toBe(true)
    expect(matchGlob('data.user.id', 'data.user.name')).toBe(false)
    expect(matchGlob('data.user', 'data.user.id')).toBe(false)
    expect(matchGlob('data.user.id', 'data.user')).toBe(false)
  })
  it('* 匹配恰好一段', () => {
    expect(matchGlob('*.metadata.*', 'data.metadata.traceId')).toBe(true)
    expect(matchGlob('*.metadata.*', 'data.metadata')).toBe(false)
    expect(matchGlob('data.*.city', 'data.address.city')).toBe(true)
    expect(matchGlob('data.*.city', 'data.a.b.city')).toBe(false)
  })
  it('** 匹配零或多段', () => {
    expect(matchGlob('data.**', 'data')).toBe(true)
    expect(matchGlob('data.**', 'data.a.b.c')).toBe(true)
    expect(matchGlob('**.id', 'data.user.id')).toBe(true)
    expect(matchGlob('**.id', 'data.user.profile')).toBe(false)
    expect(matchGlob('**', 'anything.at.all')).toBe(true)
  })
  it('混合与边界', () => {
    expect(matchGlob('data.**.id', 'data.user.id')).toBe(true)
    expect(matchGlob('data.**.id', 'data.id')).toBe(true)
    expect(matchGlob('', '')).toBe(true)
    expect(matchGlob('data', '')).toBe(false)
    expect(matchGlob('data.**', 'database.x')).toBe(false) // 段全等，非前缀
  })

  it('跨包契约矩阵：kernel 镜像 matcher 侧（initial-coverage ignoredGlobs）与本矩阵逐三元组全等', () => {
    // kernel 未导出私有 matcher —— 契约以本矩阵与
    // packages/kernel/src/__tests__/initial-coverage.test.ts 的 ignoredGlobs 行为矩阵互指钉住：
    // 任一侧语义漂移即对不上同一组 (pattern, path, expected) 三元组
    for (const { pattern, path, expected } of GLOB_MATRIX) {
      expect(matchGlob(pattern, path), `pattern=${pattern} path=${path}`).toBe(expected)
    }
  })
})
