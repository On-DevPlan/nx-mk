import { describe, it, expect, vi, afterEach } from 'vitest'
import { Poller, POLL_INTERVAL_MS } from '../ui/poller'

afterEach(() => vi.useRealTimers())

const okResponse = (): Response => new Response(JSON.stringify({ ok: 1 }), { status: 200 })

it('default interval is 5000', () => {
  expect(POLL_INTERVAL_MS).toBe(5000)
})

it('fetches immediately then on interval', async () => {
  vi.useFakeTimers()
  const fetchImpl = vi.fn(async () => okResponse())
  const onUpdate = vi.fn()
  new Poller('/api/x', { fetchImpl, onUpdate, onError: () => {} }).start()
  await vi.advanceTimersByTimeAsync(0)
  expect(onUpdate).toHaveBeenCalledTimes(1)
  expect(onUpdate).toHaveBeenCalledWith({ ok: 1 })
  await vi.advanceTimersByTimeAsync(5000)
  expect(fetchImpl).toHaveBeenCalledTimes(2)
})

it('stop() halts polling and aborts inflight', async () => {
  vi.useFakeTimers()
  const fetchImpl = vi.fn(async () => okResponse())
  const poller = new Poller('/api/x', { fetchImpl, onUpdate: () => {}, onError: () => {} })
  poller.start()
  await vi.advanceTimersByTimeAsync(0)
  poller.stop()
  await vi.advanceTimersByTimeAsync(20000)
  expect(fetchImpl).toHaveBeenCalledTimes(1)
})

it('errors keep polling（503 busy 自愈，spec §4）', async () => {
  vi.useFakeTimers()
  let fail = true
  const fetchImpl = vi.fn(async () => {
    if (fail) return new Response(JSON.stringify({ error: 'busy' }), { status: 503 })
    return okResponse()
  })
  const onError = vi.fn()
  const onUpdate = vi.fn()
  new Poller('/api/x', { fetchImpl, onUpdate, onError, intervalMs: 10 }).start()
  await vi.advanceTimersByTimeAsync(0)
  expect(onError).toHaveBeenCalledTimes(1)
  fail = false
  await vi.advanceTimersByTimeAsync(10)
  expect(onUpdate).toHaveBeenCalledTimes(1)
})
