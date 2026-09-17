/**
 * readInitialCoverageFromManifest 单测 (M14 收尾 + Phase 3 Task 3)
 *
 * 验证：
 * - 文件缺失 → placeholder
 * - 文件存在但解析失败 → placeholder
 * - 文件存在且有 fields → total = fields 长度，missing 的 fieldId = normalizedPath（spec §3.1）
 * - 文件存在但 fields 为空 → placeholder
 * - 无 normalizedPath 的字段跳过（防御旧 manifest）
 * - ignoredGlobs 命中的字段不进 missing（⚠️计划细化：goal 侧 policy 联动）
 *
 * ── 跨包契约矩阵（Task 3 preflight ruling）──
 * 下方 GLOB_MATRIX 与 packages/coverage/__tests__/policy-glob.test.ts 的同名矩阵
 * 逐三元组一致；矩阵改动须双侧同步（kernel 零依赖优先于 DRY，契约以行为矩阵钉住
 * kernel 内置镜像 matcher 与 coverage matchGlob 的语义全等）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readInitialCoverageFromManifest } from '../initial-coverage'

let workDir: string
let nxmkDir: string
let manifestPath: string

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'nx-mk-init-coverage-'))
  nxmkDir = join(workDir, '.nx-mk')
  mkdirSync(nxmkDir, { recursive: true })
  manifestPath = join(nxmkDir, 'manifest.json')
})

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true })
})

const PLACEHOLDER = {
  total: 1,
  covered: 0,
  ratio: 0,
  missing: [{ kind: 'field', fieldId: '__placeholder__' }],
} as const

// 跨包契约矩阵：字面 / * / ** / 混合各含正反例，共 10 组三元组。
// 与 packages/coverage/__tests__/policy-glob.test.ts 的同名矩阵逐三元组一致，
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

describe('readInitialCoverageFromManifest', () => {
  it('returns placeholder when manifest.json does not exist', () => {
    const result = readInitialCoverageFromManifest(workDir)
    expect(result).toEqual({
      total: 1,
      covered: 0,
      ratio: 0,
      missing: [{ kind: 'field', fieldId: '__placeholder__' }],
    })
  })

  it('returns placeholder when manifest.json is invalid JSON', () => {
    writeFileSync(manifestPath, 'not json {{')
    const result = readInitialCoverageFromManifest(workDir)
    expect(result.missing).toEqual(PLACEHOLDER.missing)
  })

  it('returns placeholder when fields array is missing', () => {
    writeFileSync(manifestPath, JSON.stringify({ version: '1', endpoints: [] }))
    const result = readInitialCoverageFromManifest(workDir)
    expect(result.missing).toEqual(PLACEHOLDER.missing)
  })

  it('returns placeholder when fields array is empty', () => {
    writeFileSync(manifestPath, JSON.stringify({ fields: [] }))
    const result = readInitialCoverageFromManifest(workDir)
    expect(result.missing).toEqual(PLACEHOLDER.missing)
  })

  it('builds Coverage from manifest.fields when present', () => {
    // Task 3（spec §3.1）：fieldId = normalizedPath，不再是 stableFieldId 哈希
    const manifest = {
      version: '1',
      fields: [
        { id: 'aaa111', normalizedPath: 'data.user.id' },
        { id: 'bbb222', normalizedPath: 'data.user.name' },
        { id: 'ccc333', normalizedPath: 'data.user.email' },
        { id: 'ddd444', normalizedPath: 'data.tags[]' },
        { id: 'eee555', normalizedPath: 'data.items[].sku' },
      ],
    }
    writeFileSync(manifestPath, JSON.stringify(manifest))
    const result = readInitialCoverageFromManifest(workDir)
    expect(result.total).toBe(5)
    expect(result.covered).toBe(0)
    expect(result.ratio).toBe(0)
    expect(result.missing).toEqual([
      { kind: 'field', fieldId: 'data.user.id' },
      { kind: 'field', fieldId: 'data.user.name' },
      { kind: 'field', fieldId: 'data.user.email' },
      { kind: 'field', fieldId: 'data.tags[]' },
      { kind: 'field', fieldId: 'data.items[].sku' },
    ])
  })

  it('skips fields with missing or empty id', () => {
    const manifest = {
      fields: [
        { id: 'valid1', normalizedPath: 'data.v1' },
        { id: '' },        // 空 id 跳过
        { /* no id */ },  // 缺 id 跳过
        { id: 'valid2', normalizedPath: 'data.v2' },
      ],
    }
    writeFileSync(manifestPath, JSON.stringify(manifest))
    const result = readInitialCoverageFromManifest(workDir)
    expect(result.total).toBe(2)
    expect(result.missing.map((m) => m.kind === 'field' && m.fieldId)).toEqual(['data.v1', 'data.v2'])
  })

  it('returns placeholder when all fields have invalid ids', () => {
    const manifest = { fields: [{ id: '' }, { /* no id */ }] }
    writeFileSync(manifestPath, JSON.stringify(manifest))
    const result = readInitialCoverageFromManifest(workDir)
    expect(result.missing).toEqual(PLACEHOLDER.missing)
  })

  // ── Phase 3 Task 3（spec §3.1 + ⚠️计划细化：ignoredGlobs）──

  it('missing 项 fieldId = normalizedPath（不再是 stableFieldId 哈希，spec §3.1）', () => {
    const manifest = {
      fields: [
        { id: 'hash1', normalizedPath: 'data.name' },
        { id: 'hash2', normalizedPath: 'data.tags[]' },
      ],
    }
    writeFileSync(manifestPath, JSON.stringify(manifest))
    const result = readInitialCoverageFromManifest(workDir)
    expect(result.missing).toEqual([
      { kind: 'field', fieldId: 'data.name' },
      { kind: 'field', fieldId: 'data.tags[]' },
    ])
    expect(result.total).toBe(2)
  })

  it('无 normalizedPath 的字段跳过（防御旧 manifest）', () => {
    const manifest = { fields: [{ id: 'a' }, { id: 'b', normalizedPath: 'data.x' }] }
    writeFileSync(manifestPath, JSON.stringify(manifest))
    const result = readInitialCoverageFromManifest(workDir)
    expect(result.missing).toEqual([{ kind: 'field', fieldId: 'data.x' }])
    expect(result.total).toBe(1)
  })

  it('ignoredGlobs 排除字段（⚠️计划细化：goal 侧 policy 联动）', () => {
    const manifest = {
      fields: [
        { id: 'hash1', normalizedPath: 'data.name' },
        { id: 'hash2', normalizedPath: 'data.tags[]' },
      ],
    }
    writeFileSync(manifestPath, JSON.stringify(manifest))
    const result = readInitialCoverageFromManifest(workDir, { ignoredGlobs: ['data.*'] })
    // 全部被 policy 排除 → missing 空、total 0；
    // ratio=1 对齐 computeCoverage 的 total=0 口径（goal-loop 边界检查零轮即 met）
    expect(result.missing).toEqual([])
    expect(result.total).toBe(0)
    expect(result.ratio).toBe(1)
  })

  it('ignoredGlobs 用 ** 段通配', () => {
    const manifest = {
      fields: [
        { id: 'r', normalizedPath: 'data.internalRiskScore' },
        { id: 'n', normalizedPath: 'data.name' },
      ],
    }
    writeFileSync(manifestPath, JSON.stringify(manifest))
    const result = readInitialCoverageFromManifest(workDir, {
      ignoredGlobs: ['**.internalRiskScore'],
    })
    expect(result.missing).toEqual([{ kind: 'field', fieldId: 'data.name' }])
    expect(result.total).toBe(1)
  })

  it('跨包契约矩阵：ignoredGlobs 逐三元组断言排除行为（与 coverage matchGlob 全等）', () => {
    // kernel 未导出私有 matcher —— 契约以本侧行为矩阵与
    // packages/coverage/__tests__/policy-glob.test.ts 的 matchGlob 矩阵互指钉住
    for (const { pattern, path, expected } of GLOB_MATRIX) {
      writeFileSync(manifestPath, JSON.stringify({ fields: [{ id: 'f1', normalizedPath: path }] }))
      const result = readInitialCoverageFromManifest(workDir, { ignoredGlobs: [pattern] })
      if (expected) {
        expect(result.missing, `pattern=${pattern} path=${path} 应被排除`).toEqual([])
        expect(result.total, `pattern=${pattern} path=${path}`).toBe(0)
      } else {
        expect(result.missing, `pattern=${pattern} path=${path} 不应被排除`).toEqual([
          { kind: 'field', fieldId: path },
        ])
        expect(result.total, `pattern=${pattern} path=${path}`).toBe(1)
      }
    }
  })
})