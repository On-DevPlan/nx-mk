import { describe, it, expect } from 'vitest'
import { normalizePath } from '../normalizer'

describe('normalizePath (Plan §17)', () => {
  it('replaces numeric array indices with []', () => {
    expect(normalizePath('orders.0.items.2.skuName')).toBe('orders[].items[].skuName')
  })

  it('handles top-level array', () => {
    expect(normalizePath('0.id')).toBe('[].id')
  })

  it('handles deeply nested arrays', () => {
    expect(normalizePath('a.0.b.1.c.2')).toBe('a[].b[].c[]')
  })

  it('leaves non-numeric segments unchanged', () => {
    expect(normalizePath('data.user.name')).toBe('data.user.name')
  })

  it('leaves single segment unchanged', () => {
    expect(normalizePath('data')).toBe('data')
  })

  it('leaves empty string unchanged', () => {
    expect(normalizePath('')).toBe('')
  })

  it('does not touch non-digit chars that look like numbers (defensive)', () => {
    expect(normalizePath('user.1a.profile')).toBe('user.1a.profile')
  })

  it('handles numeric segments of varying lengths', () => {
    expect(normalizePath('items.42.id')).toBe('items[].id')
    expect(normalizePath('items.100.id')).toBe('items[].id')
  })

  it('handles object-in-array pattern', () => {
    expect(normalizePath('data.0.user.id')).toBe('data[].user.id')
  })

  it('returns input unchanged when no numeric segments', () => {
    expect(normalizePath('a.b.c.d')).toBe('a.b.c.d')
  })
})
