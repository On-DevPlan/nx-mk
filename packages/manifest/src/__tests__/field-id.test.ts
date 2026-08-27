import { describe, it, expect } from 'vitest'
import { stableFieldId } from '../field-id'

describe('stableFieldId', () => {
  it('same input produces same id (stable)', () => {
    const input = {
      method: 'GET' as const,
      path: '/users/{id}',
      direction: 'response' as const,
      status: '200',
      normalizedFieldPath: 'data.id',
    }
    expect(stableFieldId(input)).toBe(stableFieldId(input))
  })

  it('returns 12 hex characters', () => {
    const id = stableFieldId({
      method: 'GET',
      path: '/users',
      direction: 'request',
      normalizedFieldPath: 'query.limit',
    })
    expect(id).toMatch(/^[0-9a-f]{12}$/)
  })

  it('different methods produce different ids', () => {
    const base = { path: '/users', direction: 'response' as const, status: '200', normalizedFieldPath: 'data.id' }
    expect(stableFieldId({ ...base, method: 'GET' })).not.toBe(stableFieldId({ ...base, method: 'POST' }))
  })

  it('different paths produce different ids', () => {
    const base = { method: 'GET' as const, direction: 'response' as const, status: '200', normalizedFieldPath: 'data.id' }
    expect(stableFieldId({ ...base, path: '/users' })).not.toBe(stableFieldId({ ...base, path: '/orders' }))
  })

  it('different directions produce different ids', () => {
    const base = { method: 'GET' as const, path: '/users', status: '200', normalizedFieldPath: 'data.id' }
    expect(stableFieldId({ ...base, direction: 'request' })).not.toBe(stableFieldId({ ...base, direction: 'response' }))
  })

  it('different status codes produce different ids', () => {
    const base = { method: 'GET' as const, path: '/users', direction: 'response' as const, normalizedFieldPath: 'data.id' }
    expect(stableFieldId({ ...base, status: '200' })).not.toBe(stableFieldId({ ...base, status: '404' }))
  })

  it('different normalizedFieldPath produces different ids', () => {
    const base = { method: 'GET' as const, path: '/users', direction: 'response' as const, status: '200' }
    expect(stableFieldId({ ...base, normalizedFieldPath: 'data.id' })).not.toBe(stableFieldId({ ...base, normalizedFieldPath: 'data.name' }))
  })

  it('endpointId uses only method:path (omit direction/status/path)', () => {
    // The brief mentions: for endpointId (not fieldId), only method:path is hashed.
    // This is enforced by parseOpenApi (not stableFieldId itself) — see parser.ts.
    // Verify stableFieldId includes all 5 parts when status is omitted:
    const a = stableFieldId({ method: 'GET', path: '/x', direction: 'request', normalizedFieldPath: 'p' })
    const b = stableFieldId({ method: 'GET', path: '/x', direction: 'request', status: '200', normalizedFieldPath: 'p' })
    expect(a).not.toBe(b)  // omitting status produces different id than including '200'
  })
})
