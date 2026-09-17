/**
 * Phase 3 集成（hermetic，spec §1.4 / §3.6）：
 *  ① 三点契约：manifest fieldPath ↔ proxy normalizedPath ↔ DOM data-mk-field 同空间
 *  ② policy → analyzer → CoverageReport 全链（ignored 不进分母、进 ignored-returned）
 *  ③ initial-coverage ignoredGlobs 与 coverage matchGlob 跨包矩阵契约（与
 *     coverage/__tests__/policy-glob.test.ts 和 kernel initial-coverage.test.ts 同名矩阵互指同步）
 *
 * 不跑真浏览器 —— 真实链路 = demo 手动验收（README 步骤）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openCoverageDb } from '@nx-mk/coverage'
import { evaluatePolicy, matchGlob, analyzeCoverage } from '@nx-mk/coverage'
import { createCollector } from '@nx-mk/client/collector'
import { createTrackedProxy } from '@nx-mk/client/proxy'
import { readInitialCoverageFromManifest } from '@nx-mk/kernel'
import type { ApiManifest } from '@nx-mk/manifest-schema'

// demo User 语义 fixture：对齐 manifest 真值（normalizedPath 形态）
// required name/email/address.city/address.zip；tags[] 是数组归一化形态；internalRiskScore ignored
const MANIFEST: ApiManifest = {
  version: '1',
  source: { type: 'openapi', input: 'fixture', hash: '0000000000000000' },
  generatedAt: '2026-09-17T00:00:00.000Z',
  endpoints: [
    {
      id: 'ep_getUser',
      method: 'GET',
      path: '/users/{id}',
      operationId: 'getUser',
      summary: 'Get user by ID',
      tags: ['users'],
      responses: [{
        status: '200',
        fields: [
          { id: 'f_id', endpointId: 'ep_getUser', direction: 'response', status: '200', path: 'data.id', normalizedPath: 'data.id', name: 'id', type: 'string', required: true, source: { openapiPointer: '/id' } },
          { id: 'f_name', endpointId: 'ep_getUser', direction: 'response', status: '200', path: 'data.name', normalizedPath: 'data.name', name: 'name', type: 'string', required: true, source: { openapiPointer: '/name' } },
          { id: 'f_email', endpointId: 'ep_getUser', direction: 'response', status: '200', path: 'data.email', normalizedPath: 'data.email', name: 'email', type: 'string', required: true, source: { openapiPointer: '/email' } },
          { id: 'f_tags', endpointId: 'ep_getUser', direction: 'response', status: '200', path: 'data.tags', normalizedPath: 'data.tags[]', name: 'tags', type: 'string', required: true, source: { openapiPointer: '/tags' } },
          { id: 'f_addr', endpointId: 'ep_getUser', direction: 'response', status: '200', path: 'data.address', normalizedPath: 'data.address', name: 'address', type: 'object', required: true, source: { openapiPointer: '/address' } },
          { id: 'f_city', endpointId: 'ep_getUser', direction: 'response', status: '200', path: 'data.address.city', normalizedPath: 'data.address.city', name: 'city', type: 'string', required: true, source: { openapiPointer: '/address/city' } },
          { id: 'f_zip', endpointId: 'ep_getUser', direction: 'response', status: '200', path: 'data.address.zip', normalizedPath: 'data.address.zip', name: 'zip', type: 'string', required: true, source: { openapiPointer: '/address/zip' } },
          { id: 'f_risk', endpointId: 'ep_getUser', direction: 'response', status: '200', path: 'data.internalRiskScore', normalizedPath: 'data.internalRiskScore', name: 'internalRiskScore', type: 'number', required: false, source: { openapiPointer: '/internalRiskScore' } },
        ],
      }],
    },
  ],
  schemas: {
    User: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
      },
      required: ['id', 'name'],
    },
  },
  fields: [
    { id: 'f_id', endpointId: 'ep_getUser', direction: 'response', status: '200', path: 'data.id', normalizedPath: 'data.id', name: 'id', type: 'string', required: true, source: { openapiPointer: '/id' } },
    { id: 'f_name', endpointId: 'ep_getUser', direction: 'response', status: '200', path: 'data.name', normalizedPath: 'data.name', name: 'name', type: 'string', required: true, source: { openapiPointer: '/name' } },
    { id: 'f_email', endpointId: 'ep_getUser', direction: 'response', status: '200', path: 'data.email', normalizedPath: 'data.email', name: 'email', type: 'string', required: true, source: { openapiPointer: '/email' } },
    { id: 'f_tags', endpointId: 'ep_getUser', direction: 'response', status: '200', path: 'data.tags', normalizedPath: 'data.tags[]', name: 'tags', type: 'string', required: true, source: { openapiPointer: '/tags' } },
    { id: 'f_addr', endpointId: 'ep_getUser', direction: 'response', status: '200', path: 'data.address', normalizedPath: 'data.address', name: 'address', type: 'object', required: true, source: { openapiPointer: '/address' } },
    { id: 'f_city', endpointId: 'ep_getUser', direction: 'response', status: '200', path: 'data.address.city', normalizedPath: 'data.address.city', name: 'city', type: 'string', required: true, source: { openapiPointer: '/address/city' } },
    { id: 'f_zip', endpointId: 'ep_getUser', direction: 'response', status: '200', path: 'data.address.zip', normalizedPath: 'data.address.zip', name: 'zip', type: 'string', required: true, source: { openapiPointer: '/address/zip' } },
    { id: 'f_risk', endpointId: 'ep_getUser', direction: 'response', status: '200', path: 'data.internalRiskScore', normalizedPath: 'data.internalRiskScore', name: 'internalRiskScore', type: 'number', required: false, source: { openapiPointer: '/internalRiskScore' } },
  ],
}

// DOM data-mk-field 约定值（demo 组件与 manifest 对齐后应逐字等于 normalizedPath）
// data.tags 经 manifest 归一化 → data.tags[]；DOM 直报值取 normalizedPath 真值
const DOM_FIELDS = ['data.name', 'data.email', 'data.tags[]', 'data.internalRiskScore']

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nx-mk-p3-'))
  mkdirSync(join(dir, '.nx-mk'), { recursive: true })
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('Phase 3 三点契约 + 全链', () => {
  it('三点契约：DOM data-mk-field 每项都落在 proxy hit 空间与 manifest fieldPath 空间的交集语义内', () => {
    // ① proxy 空间：逐字段读取（含 tags 数组迭代）
    const c = createCollector()
    const data = createTrackedProxy(
      { name: 'Alice', email: 'E', tags: ['admin', 'beta'], address: { city: 'HZ', zip: '310000' }, internalRiskScore: 0.12 },
      { requestId: 'r1', endpointId: 'ep_getUser', basePath: 'data', collector: c } as never,
    ) as Record<string, unknown>
    // 读取：name / email / tags（迭代） / address（中间节点）/ city / zip / internalRiskScore
    void data.name
    void data.email
    const tags = data.tags as unknown[]
    for (const _ of tags) { /* 数组迭代：[] 下标 get */ }
    const addr = data.address as Record<string, unknown>
    void addr.city
    void addr.zip
    void data.internalRiskScore
    const drained = c.drain()
    const proxyPaths = new Set(drained.hits.map((h) => h.normalizedPath))

    // ② manifest 空间
    const manifestPaths = new Set(MANIFEST.fields.map((f) => f.normalizedPath))

    // ③ 契约：DOM_FIELDS（除 data.tags[] 形态外）必须 ∈ 两侧空间；
    //    data.tags[] 是数组归一化单列形态，在两侧均为 'data.tags[]'
    for (const domField of DOM_FIELDS) {
      expect(manifestPaths, `DOM ${domField} ∈ manifest`).toContain(domField)
      // proxy 读取的叶子/中间节点路径必须落在 manifest normalizedPath 集合
      const proxyHit = [...proxyPaths].some((p) => p === domField || domField.startsWith(p) || p.startsWith(domField))
      expect(proxyHit, `DOM ${domField} ∈ proxy hit`).toBe(true)
    }
    // 契约：所有 proxy hit 均为合法路径（无 data.then / tags.join / length 噪音）
    for (const p of proxyPaths) {
      expect(p).not.toContain('.then')
      expect(p).not.toContain('.join')
      expect(!p.endsWith('.length')).toBe(true)
    }
  })

  it('policy → analyzer → CoverageReport：ignored 不进分母且进 ignored-returned', () => {
    const c = createCollector()
    const data = createTrackedProxy(
      { id: 'u_001', name: 'A', email: 'E', tags: ['t'], address: { city: 'HZ', zip: '310000' }, internalRiskScore: 0.12 },
      { requestId: 'r1', endpointId: 'ep_getUser', basePath: 'data', collector: c } as never,
    ) as Record<string, unknown>
    void data.id
    void data.name
    void data.email
    void (data.tags as unknown[])[0]
    void (data.address as Record<string, unknown>).city
    void (data.address as Record<string, unknown>).zip
    void data.internalRiskScore

    const drained = c.drain()
    const db = openCoverageDb(join(dir, '.nx-mk', 'coverage.db'))
    try {
      db.insertRun('run_t', new Date().toISOString(), 'running')
      db.flushDrained({ runId: 'run_t', ...drained })

      const decisions = evaluatePolicy(MANIFEST.fields, { ignored: ['data.internalRiskScore'] })
      const report = analyzeCoverage({ runId: 'run_t', manifest: MANIFEST, policyDecisions: decisions, drained, db })

      // internalRiskScore ignored → 进 ignored-returned（hit 存在）；required 全命中 → requiredCoverage 1
      expect(report.metrics.requiredCoverage).toBe(1)
      expect(report.ignoredReturnedFields).toHaveLength(1)
      expect(report.ignoredReturnedFields[0]?.fieldPath).toBe('data.internalRiskScore')
      expect(report.metrics.missingRequiredFields).toBe(0)
      // report JSON 可序列化（深等）
      const roundtrip = JSON.parse(JSON.stringify(report)) as typeof report
      expect(roundtrip.metrics.requiredCoverage).toBe(1)
      expect(roundtrip.requests).toBeDefined()
    } finally {
      db.close()
    }
  })

  it('goal 侧契约：initial-coverage ignoredGlobs 与 coverage matchGlob 同矩阵', () => {
    // 跨包契约矩阵（与 coverage/policy-glob.test.ts 头部常量互指同步）
    const GLOB_MATRIX: ReadonlyArray<{ pattern: string; path: string; expected: boolean }> = [
      { pattern: 'data.user.id', path: 'data.user.id', expected: true },
      { pattern: 'data.user.id', path: 'data.user.name', expected: false },
      { pattern: 'data.user', path: 'data.user.id', expected: false },
      { pattern: 'data.*.city', path: 'data.address.city', expected: true },
      { pattern: 'data.*.city', path: 'data.a.b.city', expected: false },
      { pattern: '*.metadata.*', path: 'data.metadata', expected: false },
      { pattern: '**.internalRiskScore', path: 'data.internalRiskScore', expected: true },
      { pattern: '**.internalRiskScore', path: 'data.name', expected: false },
      { pattern: 'data.**.id', path: 'data.user.profile.id', expected: true },
      { pattern: 'data.**', path: 'database.x', expected: false },
    ]
    // coverage 侧 matchGlob 逐三元组自洽
    for (const { pattern, path, expected } of GLOB_MATRIX) {
      expect(matchGlob(pattern, pattern === path ? path : path), `coverage matchGlob ${pattern}`).toBe(expected)
    }
    // kernel 侧 readInitialCoverageFromManifest 的排除行为 === matchGlob 取反
    for (const { pattern, path, expected } of GLOB_MATRIX) {
      writeFileSync(
        join(dir, '.nx-mk', 'manifest.json'),
        JSON.stringify({ fields: [{ id: 'f1', normalizedPath: path }] }),
      )
      const result = readInitialCoverageFromManifest(dir, { ignoredGlobs: [pattern] })
      if (expected) {
        expect(result.missing, `kernel ignoredGlobs pattern=${pattern} path=${path}`).toEqual([])
        expect(result.total).toBe(0)
      } else {
        expect(result.missing, `kernel ignoredGlobs pattern=${pattern} path=${path}`).toEqual([
          { kind: 'field', fieldId: path },
        ])
        expect(result.total).toBe(1)
      }
    }
  })
})
