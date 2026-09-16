/**
 * coverage analyzer v0（spec D7）：required 未访问 = missing；
 * optional 字段只要已命中也计入 total/covered，但永不进 missing；
 * field-hit 命中 → coverage 状态 counted；产出 coverage_fields 行 + missing 数组。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openCoverageDb } from '../src/db/client.js'
import { analyzeCoverage } from '../src/analyzer/coverage-analyzer.js'
import type { ApiManifest } from '@nx-mk/manifest-schema'

let dir: string
const MANIFEST: ApiManifest = {
  version: '1',
  source: { type: 'openapi', input: 'x.json', hash: 'h' },
  generatedAt: '',
  schemas: {},
  fields: [
    { id: 'f_id', endpointId: 'ep1', direction: 'response', status: '200', path: 'data.id', normalizedPath: 'data.id', name: 'id', type: 'string', required: true, source: { openapiPointer: '' } },
    { id: 'f_addr', endpointId: 'ep1', direction: 'response', status: '200', path: 'data.address.zip', normalizedPath: 'data.address.zip', name: 'zip', type: 'string', required: false, source: { openapiPointer: '' } },
  ],
  endpoints: [{ id: 'ep1', method: 'GET', path: '/users/{id}', responses: [{ status: '200', fields: [] }] }],
}

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nx-mk-an-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('analyzeCoverage', () => {
  it('required 且命中 → coverage_state=covered counted_required=1', () => {
    const db = openCoverageDb(join(dir, 'c.db'))
    try {
      const r = analyzeCoverage(db, 'run1', MANIFEST, { hits: [{ normalizedPath: 'data.id', count: 3 }] })
      expect(r.total).toBe(2)               // manifest 2 个 response field
      expect(r.covered).toBe(1)             // required 命中 → covered 计数
      expect(r.missing).toEqual([])         // f_id required 且已命中 → missing 空（D7：optional 恒不进 missing）
      void r
    } finally { db.close() }
  })

  it('optional 未命中不计入 missing（D7 v0 只看 required）', () => {
    const M: ApiManifest = { ...MANIFEST, fields: [MANIFEST.fields[1]!] }  // 仅 optional 字段
    const db = openCoverageDb(join(dir, 'c.db'))
    try {
      const r = analyzeCoverage(db, 'run1', M, { hits: [] })
      expect(r.missing).toEqual([])         // 无 required 字段的 manifest → empty missing
      void r
    } finally { db.close() }
  })

  it('required 未命中 → missing 含该 fieldPath', () => {
    const M: ApiManifest = { ...MANIFEST, fields: [MANIFEST.fields[0]!] }
    const db = openCoverageDb(join(dir, 'c.db'))
    try {
      const r = analyzeCoverage(db, 'run1', M, { hits: [] })
      expect(r.missing).toEqual(['data.id'])
    } finally { db.close() }
  })

  it('coverage_fields 行写入：13 列、state 与计数正确', () => {
    const db = openCoverageDb(join(dir, 'c.db'))
    try {
      analyzeCoverage(db, 'run1', MANIFEST, { hits: [{ normalizedPath: 'data.id', count: 2 }] })
      const row = db.prepare(`SELECT * FROM coverage_fields WHERE field_id = 'f_id'`).get() as Record<string, unknown>
      expect(row).toMatchObject({
        id: 'cf_run1_data.id',
        run_id: 'run1',
        field_id: 'f_id',
        endpoint_id: 'ep1',
        field_path: 'data.id',
        policy_status: 'default',
        coverage_state: 'covered',
        access_hit: 1,
        ui_hit: 0,
        assertion_hit: 0,
        suspicious: 0,
        counted_required: 1,
        counted_effective: 1,
      })
      const row2 = db.prepare(`SELECT * FROM coverage_fields WHERE field_id = 'f_addr'`).get() as Record<string, unknown>
      expect(row2).toMatchObject({ coverage_state: 'optional-unhit', counted_required: 0, counted_effective: 0 })
    } finally { db.close() }
  })
})
