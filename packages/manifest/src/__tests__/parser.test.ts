import { describe, it, expect } from 'vitest'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { parseOpenApi } from '../parser'

const FIXTURE = resolve(fileURLToPath(new URL('.', import.meta.url)), 'fixtures/openapi-minimal.json')

describe('parseOpenApi', () => {
  it('parses minimal OpenAPI 3 spec and returns ApiManifest', async () => {
    const manifest = await parseOpenApi(FIXTURE)
    expect(manifest.version).toBe('1')
    expect(manifest.source.type).toBe('openapi')
    expect(manifest.source.input).toContain('openapi-minimal.json')
    expect(manifest.source.hash).toMatch(/^[0-9a-f]{16}$/)
    expect(manifest.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)  // ISO 8601
  })

  it('extracts endpoints from paths', async () => {
    const manifest = await parseOpenApi(FIXTURE)
    expect(manifest.endpoints).toHaveLength(1)
    expect(manifest.endpoints[0]).toMatchObject({
      method: 'GET',
      path: '/users/{id}',
      operationId: 'getUser',
      summary: 'Get user by ID',
      tags: undefined,
    })
    expect(manifest.endpoints[0]!.id).toMatch(/^[0-9a-f]{12}$/)
  })

  it('extracts pathParams from parameters', async () => {
    const manifest = await parseOpenApi(FIXTURE)
    const ep = manifest.endpoints[0]!
    expect(ep.request?.pathParams).toHaveLength(1)
    expect(ep.request?.pathParams?.[0]).toMatchObject({
      name: 'id',
      required: true,
      type: 'string',
    })
    expect(ep.request?.pathParams?.[0]?.path).toBe('id')
  })

  it('extracts response fields from 200 schema', async () => {
    const manifest = await parseOpenApi(FIXTURE)
    const ep = manifest.endpoints[0]!
    const response200 = ep.responses.find((r) => r.status === '200')
    expect(response200).toBeDefined()
    const fieldNames = response200!.fields.map((f) => f.name).sort()
    expect(fieldNames).toContain('id')
    expect(fieldNames).toContain('name')
    expect(fieldNames).toContain('email')
  })

  it('assigns stable endpointId and fieldIds', async () => {
    const a = await parseOpenApi(FIXTURE)
    const b = await parseOpenApi(FIXTURE)
    expect(a.endpoints[0]!.id).toBe(b.endpoints[0]!.id)
    const aIds = a.endpoints[0]!.responses[0]!.fields.map((f) => f.id)
    const bIds = b.endpoints[0]!.responses[0]!.fields.map((f) => f.id)
    expect(aIds).toEqual(bIds)
  })

  it('produces same source.hash for same input file', async () => {
    const a = await parseOpenApi(FIXTURE)
    const b = await parseOpenApi(FIXTURE)
    expect(a.source.hash).toBe(b.source.hash)
  })

  it('flattens User schema (referenced via $ref) into response fields', async () => {
    const manifest = await parseOpenApi(FIXTURE)
    const fields200 = manifest.endpoints[0]!.responses.find((r) => r.status === '200')!.fields
    const names = fields200.map((f) => f.name)
    expect(names).toContain('id')
    expect(names).toContain('name')
    expect(names).toContain('email')
  })

  it('populates ApiManifest.fields (all fields flattened across endpoints)', async () => {
    const manifest = await parseOpenApi(FIXTURE)
    // Should include id, name, email, tags, address.city, address.zip
    expect(manifest.fields.length).toBeGreaterThanOrEqual(5)
  })

  it('throws an error when file does not exist', async () => {
    await expect(parseOpenApi('/nonexistent/spec.json')).rejects.toBeDefined()
  })

  it('throws when file is invalid OpenAPI', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'parser-invalid-'))
    const bad = join(dir, 'bad.json')
    writeFileSync(bad, '{"openapi": "3.0.0", "paths": "not-an-object"}')
    await expect(parseOpenApi(bad)).rejects.toBeDefined()
    // cleanup happens via mkdtempSync patterns; not strictly needed in test
  })
})
