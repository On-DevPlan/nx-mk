/**
 * 有限通配匹配（spec §3.2）：按 '.' 分段；* 匹配单段；** 匹配零或多段；其余字面全等。
 * 这是 policy-engine 的地基 —— 语义矩阵在此钉死，kernel 侧镜像实现靠跨包契约测试对齐（Task 3）。
 */
import { describe, it, expect } from 'vitest'
import { matchGlob } from '../src/policy/index.js'

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
})
