import { describe, it, expect } from 'vitest'
import { matchRoute, parseHash, resolvePage } from '../ui/router'

describe('matchRoute', () => {
  it('literal segments must equal', () => {
    expect(matchRoute('/runs', '/runs')).toEqual({})
    expect(matchRoute('/runs', '/fields')).toBeNull()
  })
  it(':param extracts + decodes', () => {
    expect(matchRoute('/runs/:runId/fields', '/runs/run_a/fields')).toEqual({ runId: 'run_a' })
    expect(matchRoute('/runs/:runId', '/runs/run%20a')).toEqual({ runId: 'run a' })
  })
  it('segment count mismatch → null', () => {
    expect(matchRoute('/runs/:runId', '/runs/a/fields')).toBeNull()
  })
})

describe('parseHash', () => {
  it('strips # and query; empty → /', () => {
    expect(parseHash('#/runs/run_a?x=1')).toBe('/runs/run_a')
    expect(parseHash('')).toBe('/')
    expect(parseHash('#/')).toBe('/')
  })
})

describe('resolvePage', () => {
  it('matches route table', () => {
    expect(resolvePage('/')).toEqual({ page: 'overview', params: {} })
    expect(resolvePage('/runs')).toEqual({ page: 'runs', params: {} })
    expect(resolvePage('/runs/run_a')).toEqual({ page: 'run', params: { runId: 'run_a' } })
    expect(resolvePage('/runs/run_a/requests/req_1')).toEqual({ page: 'request', params: { runId: 'run_a', requestId: 'req_1' } })
    expect(resolvePage('/runs/run_a/fields')).toEqual({ page: 'fields', params: { runId: 'run_a' } })
    expect(resolvePage('/runs/run_a/ignored')).toEqual({ page: 'ignored', params: { runId: 'run_a' } })
  })
  it('unknown → not-found', () => {
    expect(resolvePage('/nope')).toEqual({ page: 'not-found', params: {} })
  })
  it('malformed percent-escape → not-found（不在渲染期抛 URIError）', () => {
    expect(resolvePage('/runs/%zz')).toEqual({ page: 'not-found', params: {} })
  })
})
