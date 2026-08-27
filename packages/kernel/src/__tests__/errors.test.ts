import { describe, it, expect } from 'vitest'
import { KernelError, mapErrorCodeToExit, type ErrorCode } from '../errors'

describe('KernelError', () => {
  it('sets name, code, message, and preserves cause', () => {
    const cause = new Error('original')
    const err = new KernelError('PLUGIN_HOOK_FAILED', 'plugin X failed', cause)
    expect(err.name).toBe('KernelError')
    expect(err.code).toBe('PLUGIN_HOOK_FAILED')
    expect(err.message).toBe('plugin X failed')
    expect(err.cause).toBe(cause)
    expect(err).toBeInstanceOf(Error)
  })

  it('is throwable and catchable', () => {
    expect(() => {
      throw new KernelError('CONFIG_NOT_FOUND', 'missing config')
    }).toThrow(KernelError)
  })
})

describe('mapErrorCodeToExit', () => {
  const cases: Array<[ErrorCode | undefined, 1 | 2 | 3 | 4 | 5]> = [
    ['CONFIG_NOT_FOUND', 2],
    ['CONFIG_INVALID', 2],
    ['PLUGIN_LOAD_FAILED', 3],
    ['PLUGIN_SHAPE_INVALID', 3],
    ['PLUGIN_HOOK_FAILED', 4],
    ['KERNEL_INTERNAL', 5],
    [undefined, 1],
  ]
  for (const [code, expected] of cases) {
    it(`maps ${String(code)} → exit ${expected}`, () => {
      expect(mapErrorCodeToExit(code)).toBe(expected)
    })
  }
})