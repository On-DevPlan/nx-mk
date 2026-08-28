import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { validateConfig, ValidationError } from '../index'
import type { StandardSchemaV1 } from '@standard-schema/spec'

describe('@nx-mk/schema', () => {
  it('returns the validated config when input passes schema', () => {
    const schema = z.object({
      name: z.string(),
      count: z.number().int().positive(),
    })
    const result = validateConfig(schema, { name: 'foo', count: 5 })
    expect(result).toEqual({ name: 'foo', count: 5 })
  })

  it('throws ValidationError with aggregated issues when input fails', () => {
    const schema = z.object({
      openapi: z.object({
        path: z.string().min(1),
        servers: z.array(z.object({ url: z.string().url() })).min(1),
      }),
    })
    try {
      validateConfig(schema, {
        openapi: {
          path: '',
          servers: [{ url: 'not-a-url' }],
        },
      })
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError)
      const vErr = err as ValidationError
      expect(vErr.issues.length).toBeGreaterThanOrEqual(2)
      expect(vErr.message).toContain('invalid config:')
      expect(vErr.message).toContain('openapi.path')
      // zod uses dot-notation for path, not bracket-notation
      expect(vErr.message).toMatch(/openapi\.servers\.0\.url/)
    }
  })

  it('handles missing required fields with path annotation', () => {
    const schema = z.object({
      info: z.object({ title: z.string(), version: z.string() }),
    })
    try {
      validateConfig(schema, { info: { title: 'x' } })
      expect.fail('should have thrown')
    } catch (err) {
      expect((err as ValidationError).message).toContain('info.version')
    }
  })

  it('accepts any standard-schema compliant validator (not just zod)', () => {
    // 自定义 standard-schema 实现（不依赖 zod）
    const customSchema: StandardSchemaV1<unknown, { ok: true }> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: (value) => {
          if (typeof value === 'object' && value !== null && 'ok' in value) {
            return { value: { ok: true } }
          }
          return { issues: [{ message: 'must have ok property' }] }
        },
      },
    }
    expect(validateConfig(customSchema, { ok: true })).toEqual({ ok: true })
    expect(() => validateConfig(customSchema, {})).toThrow(ValidationError)
  })
})
