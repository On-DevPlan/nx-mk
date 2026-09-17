import { describe, it, expect } from 'vitest'
import { getJson, ApiError } from '../ui/api'

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status })

it('200 → parsed body', async () => {
  const data = await getJson<{ a: number }>('/api/x', async () => jsonResponse({ a: 1 }))
  expect(data).toEqual({ a: 1 })
})

it('404 with hint body → ApiError carries hint', async () => {
  const promise = getJson('/api/x', async () => jsonResponse({ error: 'unknown run', hint: 're-run' }, 404))
  await expect(promise).rejects.toMatchObject({ status: 404, hint: 're-run' })
})

it('500 with non-json body → ApiError, hint undefined', async () => {
  const err = await getJson('/api/x', async () => new Response('oops', { status: 500 })).catch((e: unknown) => e)
  expect(err).toBeInstanceOf(ApiError)
  expect((err as ApiError).hint).toBeUndefined()
})

it('network failure → original error', async () => {
  await expect(
    getJson('/api/x', async () => { throw new Error('ECONNREFUSED') }),
  ).rejects.toThrow('ECONNREFUSED')
})
