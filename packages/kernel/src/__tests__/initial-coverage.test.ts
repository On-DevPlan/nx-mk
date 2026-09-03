/**
 * readInitialCoverageFromManifest 单测 (M14 收尾)
 *
 * 验证：
 * - 文件缺失 → placeholder
 * - 文件存在但解析失败 → placeholder
 * - 文件存在且有 fields → total = fields 长度，missing = 所有 fieldId
 * - 文件存在但 fields 为空 → placeholder
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
    const manifest = {
      version: '1',
      fields: [
        { id: 'aaa111' },
        { id: 'bbb222' },
        { id: 'ccc333' },
        { id: 'ddd444' },
        { id: 'eee555' },
      ],
    }
    writeFileSync(manifestPath, JSON.stringify(manifest))
    const result = readInitialCoverageFromManifest(workDir)
    expect(result.total).toBe(5)
    expect(result.covered).toBe(0)
    expect(result.ratio).toBe(0)
    expect(result.missing).toEqual([
      { kind: 'field', fieldId: 'aaa111' },
      { kind: 'field', fieldId: 'bbb222' },
      { kind: 'field', fieldId: 'ccc333' },
      { kind: 'field', fieldId: 'ddd444' },
      { kind: 'field', fieldId: 'eee555' },
    ])
  })

  it('skips fields with missing or empty id', () => {
    const manifest = {
      fields: [
        { id: 'valid1' },
        { id: '' },        // 空 id 跳过
        { /* no id */ },  // 缺 id 跳过
        { id: 'valid2' },
      ],
    }
    writeFileSync(manifestPath, JSON.stringify(manifest))
    const result = readInitialCoverageFromManifest(workDir)
    expect(result.total).toBe(2)
    expect(result.missing.map((m) => m.kind === 'field' && m.fieldId)).toEqual(['valid1', 'valid2'])
  })

  it('returns placeholder when all fields have invalid ids', () => {
    const manifest = { fields: [{ id: '' }, { /* no id */ }] }
    writeFileSync(manifestPath, JSON.stringify(manifest))
    const result = readInitialCoverageFromManifest(workDir)
    expect(result.missing).toEqual(PLACEHOLDER.missing)
  })
})