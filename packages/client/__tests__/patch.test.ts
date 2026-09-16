/**
 * patchGlobalFetch 单测（SDK-CG3b，spec §3.5）
 *
 * 锁死：命中回调+委托、未命中只委托、幂等不叠加、unpatch 还原、无 fetch 环境降级。
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { patchGlobalFetch } from '../src/runtime/patch.js'

const fakeResponse = () => new Response('{"ok":true}', { status: 200 })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('patchGlobalFetch', () => {
  it('命中 apiPrefix：先回调 onCapture，再委托原 fetch', async () => {
    const original = vi.fn(async () => fakeResponse())
    vi.stubGlobal('fetch', original)
    const captured: { method: string; url: string }[] = []
    const unpatch = patchGlobalFetch({ onCapture: (i) => captured.push(i) })

    await fetch('/api/users/u_001')
    expect(captured).toEqual([{ method: 'GET', url: '/api/users/u_001' }])
    expect(original).toHaveBeenCalledOnce()
    unpatch()
  })

  it('未命中前缀：不回调，仍委托', async () => {
    const original = vi.fn(async () => fakeResponse())
    vi.stubGlobal('fetch', original)
    const onCapture = vi.fn()
    const unpatch = patchGlobalFetch({ onCapture })

    await fetch('https://example.com/other')
    expect(onCapture).not.toHaveBeenCalled()
    expect(original).toHaveBeenCalledOnce()
    unpatch()
  })

  it('init.method / URL 对象 / Request 形态都能解析', async () => {
    const original = vi.fn(async () => fakeResponse())
    vi.stubGlobal('fetch', original)
    const captured: string[] = []
    const unpatch = patchGlobalFetch({ onCapture: (i) => captured.push(i.method) })

    await fetch('/api/orders', { method: 'POST' })
    await fetch(new URL('http://localhost/api/users'))
    await fetch(new Request('http://localhost/api/users/u_001', { method: 'DELETE' }))
    expect(captured).toEqual(['POST', 'GET', 'DELETE'])
    unpatch()
  })

  it('幂等：已 patch 时再次调用返回 no-op，不叠加包裹', async () => {
    const original = vi.fn(async () => fakeResponse())
    vi.stubGlobal('fetch', original)
    const onCapture = vi.fn()
    const unpatch1 = patchGlobalFetch({ onCapture })
    const unpatch2 = patchGlobalFetch({ onCapture })

    await fetch('/api/users')
    expect(onCapture).toHaveBeenCalledOnce() // 只包了一层

    unpatch2() // no-op
    await fetch('/api/users')
    expect(onCapture).toHaveBeenCalledTimes(2)

    unpatch1()
  })

  it('unpatch 还原：后续调用不再回调', async () => {
    const original = vi.fn(async () => fakeResponse())
    vi.stubGlobal('fetch', original)
    const onCapture = vi.fn()
    const unpatch = patchGlobalFetch({ onCapture })
    unpatch()

    await fetch('/api/users')
    expect(onCapture).not.toHaveBeenCalled()
  })

  it('无 fetch 环境：返回 no-op unpatch 且不抛错', () => {
    vi.stubGlobal('fetch', undefined)
    const unpatch = patchGlobalFetch()
    expect(() => unpatch()).not.toThrow()
  })
})
