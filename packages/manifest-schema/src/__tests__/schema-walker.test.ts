import { describe, it, expect } from 'vitest'
import { walkSchema } from '../schema-walker'
import type { HttpMethod, WalkContext } from '../types'

const userSchema = {
  type: 'object',
  required: ['id', 'name'],
  properties: {
    id: { type: 'integer', format: 'int64' },
    name: { type: 'string', example: 'alice' },
    email: { type: 'string', format: 'email', nullable: true },
    tags: { type: 'array', items: { type: 'string' } },
    address: {
      type: 'object',
      properties: {
        city: { type: 'string' },
        zip: { type: 'string' },
      },
    },
  },
}

const baseCtx: Omit<WalkContext, 'normalizedFieldPath'> = {
  method: 'GET' as HttpMethod,
  path: '/users/{id}',
  direction: 'response',
  status: '200',
  endpointId: 'abcdef012345', // placeholder; walker uses input fields directly
}

describe('walkSchema', () => {
  it('produces a field for each top-level property', () => {
    const fields = walkSchema(userSchema, { ...baseCtx, normalizedFieldPath: 'data' })
    const names = fields.map((f) => f.name).sort()
    // address is itself an object → walker flattens it: the address descriptor
    // plus its children (whose leaf names are 'city' and 'zip').
    // Full set of leaf names: address, city, email, id, name, tags, zip.
    expect(names).toEqual(['address', 'city', 'email', 'id', 'name', 'tags', 'zip'])
  })

  it('flattens nested objects with dotted paths', () => {
    const fields = walkSchema(userSchema, { ...baseCtx, normalizedFieldPath: 'data' })
    const address = fields.find((f) => f.name === 'address' && f.schemaName === undefined)
    expect(address).toBeDefined()
    // address is itself an object → walker should produce nested fields under it
    // OR just the object descriptor. Per spec: walker flattens objects.
    // So we expect fields like 'address.city' and 'address.zip' as separate entries.
    const city = fields.find((f) => f.path === 'data.address.city')
    expect(city).toBeDefined()
    expect(city?.type).toBe('string')
  })

  it('normalizes array indices → []', () => {
    const fields = walkSchema(userSchema, { ...baseCtx, normalizedFieldPath: 'data' })
    const tags = fields.find((f) => f.name === 'tags')
    expect(tags).toBeDefined()
    // tags is array of string → walker emits one field descriptor with normalizedPath data.tags[]
    expect(tags?.normalizedPath).toBe('data.tags[]')
  })

  it('marks required fields with required: true', () => {
    const fields = walkSchema(userSchema, { ...baseCtx, normalizedFieldPath: 'data' })
    expect(fields.find((f) => f.name === 'id')?.required).toBe(true)
    expect(fields.find((f) => f.name === 'name')?.required).toBe(true)
    expect(fields.find((f) => f.name === 'email')?.required).toBeUndefined()
  })

  it('preserves nullable flag', () => {
    const fields = walkSchema(userSchema, { ...baseCtx, normalizedFieldPath: 'data' })
    expect(fields.find((f) => f.name === 'email')?.nullable).toBe(true)
  })

  it('assigns stable fieldId to each field', () => {
    const fields = walkSchema(userSchema, { ...baseCtx, normalizedFieldPath: 'data' })
    for (const f of fields) {
      expect(f.id).toMatch(/^[0-9a-f]{12}$/)
      expect(f.endpointId).toBe('abcdef012345')
    }
  })

  it('preserves the openapiPointer for each field', () => {
    const fields = walkSchema(userSchema, { ...baseCtx, normalizedFieldPath: 'data' })
    // User.id: properties.id
    expect(fields.find((f) => f.name === 'id')?.source.openapiPointer).toBe('/properties/id')
  })

  it('handles primitive schema (top-level string)', () => {
    const fields = walkSchema({ type: 'string' }, { ...baseCtx, normalizedFieldPath: 'raw' })
    expect(fields).toHaveLength(1)
    expect(fields[0]?.type).toBe('string')
    expect(fields[0]?.path).toBe('raw')
  })

  it('handles array of primitives with [] suffix', () => {
    const fields = walkSchema(
      { type: 'array', items: { type: 'number' } },
      { ...baseCtx, normalizedFieldPath: 'list' }
    )
    expect(fields).toHaveLength(1)
    expect(fields[0]?.path).toBe('list')
    expect(fields[0]?.normalizedPath).toBe('list[]')
    expect(fields[0]?.type).toBe('number')
  })

  it('names every oneOf variant under a property with the property name', () => {
    const fields = walkSchema(
      { type: 'object', properties: { foo: { oneOf: [{ type: 'string' }, { type: 'number' }] } } },
      { ...baseCtx, normalizedFieldPath: 'data' }
    )
    expect(fields).toHaveLength(2)
    for (const f of fields) {
      expect(f.name).toBe('foo')
    }
    expect(fields.map((f) => f.path)).toEqual([
      'data.foo(oneOf[0])',
      'data.foo(oneOf[1])',
    ])
    expect(fields[0]?.type).toBe('string')
    expect(fields[1]?.type).toBe('number')
  })

  it('keeps element field names for array-of-object properties', () => {
    const fields = walkSchema(
      {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'integer' },
                sku: { type: 'string' },
              },
            },
          },
        },
      },
      { ...baseCtx, normalizedFieldPath: 'data' }
    )
    // The array property itself produces no descriptor — only its element
    // fields, each carrying its own name (id / sku), NOT the array name.
    expect(fields).toHaveLength(2)
    expect(fields.map((f) => f.name)).toEqual(['id', 'sku'])
    expect(fields.map((f) => f.path)).toEqual(['data.items.id', 'data.items.sku'])
    expect(fields[0]?.type).toBe('integer')
    expect(fields[1]?.type).toBe('string')
  })

  it('keeps nested names inside object oneOf variants', () => {
    const fields = walkSchema(
      {
        type: 'object',
        properties: {
          foo: {
            oneOf: [
              { type: 'object', properties: { a: { type: 'string' } } },
              { type: 'string' },
            ],
          },
        },
      },
      { ...baseCtx, normalizedFieldPath: 'data' }
    )
    // The object variant's child keeps its own name 'a'; only the unnamed
    // primitive variant takes the property name 'foo'.
    expect(fields.map((f) => f.name).sort()).toEqual(['a', 'foo'])
    expect(fields.find((f) => f.path === 'data.foo(oneOf[0]).a')?.name).toBe('a')
    expect(fields.find((f) => f.path === 'data.foo(oneOf[1])')?.name).toBe('foo')
    expect(fields.find((f) => f.path === 'data.foo(oneOf[0]).a')?.type).toBe('string')
  })

  it('preserves element-level required inside array-of-object', () => {
    const fields = walkSchema(
      {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              required: ['id'],
              properties: {
                id: { type: 'integer' },
              },
            },
          },
        },
      },
      { ...baseCtx, normalizedFieldPath: 'data' }
    )
    // The element field's own required flag must survive the array
    // pass-through (the array property's required flag is not applied).
    expect(fields).toHaveLength(1)
    expect(fields[0]?.name).toBe('id')
    expect(fields[0]?.path).toBe('data.items.id')
    expect(fields[0]?.required).toBe(true)
  })

  it('variant branch does not leak parent required onto object-variant descendants', () => {
    const schema = {
      type: 'object',
      required: ['foo'],
      properties: {
        foo: {
          oneOf: [
            { type: 'object', required: ['a'], properties: { a: { type: 'string' } } },
            { type: 'string' },
          ],
        },
      },
    }
    const fields = walkSchema(schema, { ...baseCtx, normalizedFieldPath: 'data' })
    const childA = fields.find((f) => f.path === 'data.foo(oneOf[0]).a')
    const primitiveFoo = fields.find((f) => f.path === 'data.foo(oneOf[1])')
    // a is required in its own variant object → required: true
    expect(childA?.required).toBe(true)
    // primitive variant IS the property foo → required: true (parent required: ['foo'])
    expect(primitiveFoo?.required).toBe(true)
  })
})
