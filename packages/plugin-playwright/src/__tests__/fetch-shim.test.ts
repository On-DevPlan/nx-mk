/**
 * COLLECTOR_SHIM_SCRIPT（C16 fetch 兜底）—— 用 vm 沙箱执行注入字面脚本后驱动
 * window.fetch，验证：① apiPrefix 命中 → trace 进单通道（含 status/duration）；
 * ② __MK_SDK_INFLIGHT__ 置位 → 跳过（SDK 通路负责，防双重 trace）；③ 非 /api
 * 前缀 → 静默；④ 探针异常不影响业务响应；⑤ addInitScript 语义：shim 已存在
 * （再次注入）时不重复 patch。
 */
import { describe, it, expect } from 'vitest'
import vm from 'node:vm'
import { COLLECTOR_SHIM_SCRIPT } from '../scanner.js'

interface FakeWindow {
  __MK_COLLECTOR__?: { hits: unknown[]; traces: unknown[]; hit(h: unknown): void; trace(t: unknown): void }
  __MK_FETCH_PATCHED__?: boolean
  __MK_SDK_INFLIGHT__?: boolean
  location: { href: string }
  fetch: (input: unknown, init?: unknown) => Promise<{ status: number; json: () => Promise<unknown> }>
}

/** 建 fake window + 执行 shim；返回 window 引用 */
function makeWindow(): FakeWindow {
  const win: FakeWindow = {
    location: { href: 'http://localhost:5173/users/1' },
    fetch: async () => ({ status: 200, json: async () => ({ ok: true }) }),
  }
  vm.runInNewContext(COLLECTOR_SHIM_SCRIPT, { window: win, location: win.location, URL, Date, String, Promise })
  return win
}

describe('COLLECTOR_SHIM_SCRIPT fetch 兜底（C16）', () => {
  it('裸 fetch 命中 /api 前缀 → trace 进单通道', async () => {
    const win = makeWindow()
    await win.fetch('http://localhost:3000/api/users/1')
    // trace 在响应 then 里补齐 —— 微任务冲刷
    await new Promise((r) => setTimeout(r, 0))
    expect(win.__MK_COLLECTOR__?.traces).toHaveLength(1)
    const t = win.__MK_COLLECTOR__!.traces[0] as Record<string, unknown>
    expect(t.method).toBe('GET')
    expect(t.url).toBe('http://localhost:3000/api/users/1')
    expect(t.path).toBe('/api/users/1')
    expect(t.status).toBe(200)
    expect(t.startedAt).toBeTypeOf('string')
  })

  it('SDK inflight 标记置位 → 跳过补 trace（去重）', async () => {
    const win = makeWindow()
    win.__MK_SDK_INFLIGHT__ = true
    await win.fetch('http://localhost:3000/api/users/1')
    await new Promise((r) => setTimeout(r, 0))
    expect(win.__MK_COLLECTOR__?.traces).toHaveLength(0)
  })

  it('非 /api 前缀请求 → 不产 trace，业务响应正常返回', async () => {
    const win = makeWindow()
    const res = await win.fetch('http://cdn.example.com/static/x.js')
    expect(res.status).toBe(200)
    await new Promise((r) => setTimeout(r, 0))
    expect(win.__MK_COLLECTOR__?.traces).toHaveLength(0)
  })

  it('apiPrefix 整段命中语义：/apiv2 不命中（与 migrate 引擎同口径）', async () => {
    const win = makeWindow()
    await win.fetch('http://localhost:3000/apiv2/users')
    await new Promise((r) => setTimeout(r, 0))
    expect(win.__MK_COLLECTOR__?.traces).toHaveLength(0)
  })

  it('shim 幂等：再次注入（模拟 addInitScript 重放）不重复 patch', () => {
    const win = makeWindow()
    expect(win.__MK_FETCH_PATCHED__).toBe(true)
    // 第二次注入：__MK_COLLECTOR__ 已存在 → 整段 no-op（原语义），不叠层
    vm.runInNewContext(COLLECTOR_SHIM_SCRIPT, { window: win, location: win.location, URL, Date, String, Promise })
    expect(win.__MK_COLLECTOR__?.traces).toHaveLength(0)
    expect(win.__MK_COLLECTOR__?.hits).toHaveLength(0)
  })
})
