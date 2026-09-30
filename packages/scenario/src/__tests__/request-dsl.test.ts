/**
 * C9（§26.2）Request DSL：schema / loadRequests / verifyRequests /
 * generateRequestDslFromTraces / renderRequestDslYaml。
 *
 * 覆盖：全等状态判定、expect 三态校验、field 断言（no-body 部分降级）、
 * loader 双文件形态（纯 requests / 混合 scenarios+requests）、生成去重。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { classifyFieldState, getFieldByPath, RequestDeclFileSchema, type RequestDecl } from '../request-dsl'
import { loadRequests } from '../dsl-loader'
import { verifyRequest, verifyRequests, matchesTrace } from '../verify-requests'
import { generateRequestDslFromTraces, renderRequestDslYaml } from '../generate-request-dsl'

const DECL_GET_USER: RequestDecl = {
  id: 'req-get-user-001',
  method: 'GET',
  url: '/api/users/1',
  expect: { status: 200, fields: [{ path: 'data.name', state: 'present' }] },
}

describe('classifyFieldState / getFieldByPath', () => {
  it('五态全等判定', () => {
    expect(classifyFieldState(1)).toBe('present')
    expect(classifyFieldState('a')).toBe('present')
    expect(classifyFieldState('')).toBe('empty')
    expect(classifyFieldState([])).toBe('empty')
    expect(classifyFieldState({})).toBe('empty')
    expect(classifyFieldState(null)).toBe('null')
    expect(classifyFieldState(undefined)).toBe('undefined')
  })

  it('点路径取值（不存在 key → undefined）', () => {
    const body = { data: { name: 'Alice', tags: ['a', 'b'] } }
    expect(getFieldByPath(body, 'data.name')).toBe('Alice')
    expect(getFieldByPath(body, 'data.tags.1')).toBe('b')
    expect(getFieldByPath(body, 'data.missing')).toBeUndefined()
    expect(getFieldByPath(null, 'data.name')).toBeUndefined()
  })
})

describe('RequestDeclFileSchema', () => {
  it('合法 requests 文件通过；bad id / bad state 拒绝', () => {
    const ok = RequestDeclFileSchema.safeParse({
      version: 1,
      requests: [DECL_GET_USER],
    })
    expect(ok.success).toBe(true)
    expect(RequestDeclFileSchema.safeParse({ version: 1, requests: [{ id: 'BAD_ID', method: 'GET', url: '/x' }] }).success).toBe(false)
    expect(
      RequestDeclFileSchema.safeParse({
        version: 1,
        requests: [{ id: 'r', method: 'GET', url: '/x', expect: { fields: [{ path: 'a', state: 'wat' as never }] } }],
      }).success,
    ).toBe(false)
  })
})

describe('loadRequests', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nx-mk-req-'))
    mkdirSync(join(dir, 'mk/requests'), { recursive: true })
    writeFileSync(
      join(dir, 'mk/requests/requests.yml'),
      `version: 1
requests:
  - id: req-get-user-001
    method: GET
    url: /api/users/1
    expect:
      status: 200
`,
      'utf8',
    )
    writeFileSync(
      join(dir, 'mk/requests/mixed.yml'),
      `version: 1
scenarios:
  - id: user-profile
    name: 用户详情
    steps:
      - type: goto
        url: /users/1
requests:
  - id: req-from-mixed
    from:
      scenarioId: user-profile
      stepId: goto-1
    method: GET
    url: /api/users/2
`,
      'utf8',
    )
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('两类文件共存聚合；from/endpoint 字段透传', () => {
    const r = loadRequests(dir, ['mk/requests/**/*.yml'])
    expect(r.requests.map((x) => x.request.id).sort()).toEqual(['req-from-mixed', 'req-get-user-001'])
    expect(r.requests.find((x) => x.request.id === 'req-from-mixed')?.request.from).toEqual({
      scenarioId: 'user-profile',
      stepId: 'goto-1',
    })
    expect(r.skipped).toEqual([])
  })

  it('无 requests 段文件 → skipped 记原因；同 id 去重（首个胜出——文件名排序 dup.yml 先占）', () => {
    writeFileSync(join(dir, 'mk/requests/none.yml'), 'version: 1\nscenarios:\n  - id: s\n    name: n\n    steps:\n      - type: screenshot\n', 'utf8')
    writeFileSync(
      join(dir, 'mk/requests/dup.yml'),
      'version: 1\nrequests:\n  - id: req-get-user-001\n    method: POST\n    url: /api/users/3\n',
      'utf8',
    )
    const r = loadRequests(dir, ['mk/requests/**/*.yml'])
    // 文件按名排序：dup.yml < mixed.yml < none.yml < requests.yml —— dup 先被消费
    const kept = r.requests.find((x) => x.request.id === 'req-get-user-001')
    expect(kept?.request.url).toBe('/api/users/3')
    // id 恒唯一（requests.yml 里的同 id 被去重跳过）
    const ids = r.requests.map((x) => x.request.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(r.skipped.some((s) => s.includes('no requests: section'))).toBe(true)
    expect(r.skipped.some((s) => s.includes('duplicate request id'))).toBe(true)
  })
})

describe('verifyRequest(s)', () => {
  it('passed：匹配 trace 且 status+field 全符', () => {
    const v = verifyRequest(DECL_GET_USER, { method: 'GET', url: '/api/users/1', status: 200, responseBody: { data: { name: 'Alice' } } })
    expect(v.status).toBe('passed')
    expect(v.fields[0]).toEqual({ path: 'data.name', expect: 'present', actual: 'present', pass: true })
  })

  it('failed：status 不符 → failed', () => {
    const v = verifyRequest(DECL_GET_USER, { method: 'GET', url: '/api/users/1', status: 500, responseBody: { data: { name: 'Alice' } } })
    expect(v.status).toBe('failed')
    expect(v.statusAssertion?.pass).toBe(false)
  })

  it('field 不符 → failed；无 responseBody → no-body 部分降级（不判 fail）', () => {
    const v = verifyRequest(DECL_GET_USER, { method: 'GET', url: '/api/users/1', status: 200, responseBody: { data: {} } })
    expect(v.status).toBe('failed') // data.name expected present, got undefined
    const v2 = verifyRequest(DECL_GET_USER, { method: 'GET', url: '/api/users/1', status: 200 })
    expect(v2.status).toBe('passed')
    expect(v2.partialCount).toBe(1)
    expect(v2.fields[0]?.actual).toBe('no-body')
  })

  it('matchesTrace：method 全等领域 + url pathname 归一比较', () => {
    // 相对声明 / 含 origin 的 trace → pathname 归一后匹配
    expect(matchesTrace(DECL_GET_USER, { method: 'GET', url: 'http://localhost:3000/api/users/1' })).toBe(true)
    // method 不符 → false
    expect(matchesTrace(DECL_GET_USER, { method: 'POST', url: 'http://localhost:3000/api/users/1' })).toBe(false)
    // 不同 path → false
    expect(matchesTrace(DECL_GET_USER, { method: 'GET', url: '/api/users/2' })).toBe(false)
  })

  it('verifyRequests：无匹配 trace → skipped（预筛语义归调用层）', () => {
    const decls2: RequestDecl[] = [
      { id: 'a', method: 'GET', url: '/api/users/1' },
      { id: 'b', method: 'GET', url: '/api/users/9' }, // 无匹配 trace
    ]
    const traces = [{ method: 'GET', url: '/api/users/1', status: 200, responseBody: { data: { name: 'Bob' } } }]
    const out = verifyRequests(decls2, traces)
    expect(out.map((v) => v.status)).toEqual(['passed', 'skipped'])
    expect(out[1]?.requestId).toBe('b')
  })
})

describe('generateRequestDslFromTraces / renderRequestDslYaml', () => {
  it('去重（method+url 归一）并跳过失败请求', () => {
    const traces = [
      { method: 'get', url: 'http://x/api/users/1', status: 200 },
      { method: 'GET', url: 'http://x/api/users/1', status: 200 }, // 归一重复
      { method: 'POST', url: 'http://x/api/orders', status: 500 }, // 失败跳过
      { method: 'POST', url: 'http://x/api/orders', status: 201 },
    ]
    const gen = generateRequestDslFromTraces(traces)
    expect(gen.map((g) => g.request.id)).toEqual(['req_001', 'req_002'])
    expect(gen[1]?.request.method).toBe('POST')
    expect(gen[1]?.request.expect).toEqual({ status: 201 })
  })

  it('renderRequestDslYaml 产出可直接 loadRequests 读回', () => {
    const decls = generateRequestDslFromTraces([{ method: 'GET', url: '/api/users/1', status: 200 }]).map((g) => g.request)
    const yaml = renderRequestDslYaml(decls)
    const parsed = parse(yaml) as { version: number; requests: unknown[] }
    expect(parsed.version).toBe(1)
    expect(parsed.requests).toHaveLength(1)
  })
})