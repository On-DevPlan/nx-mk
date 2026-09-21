/**
 * ScenarioFileSchema（spec S2/SP2）：5 种 step discriminated union + version 门 + id 约束。
 */
import { describe, it, expect } from 'vitest'
import { ScenarioFileSchema, ScenarioStepSchema } from '../dsl-schema'

const base = { version: 1, scenarios: [{ id: 'user-profile', name: '用户详情', steps: [] }] }

describe('ScenarioStepSchema — 5 种 step', () => {
  it('goto / waitFor / waitForRequest / assertFieldVisible / screenshot 各自解析', () => {
    expect(ScenarioStepSchema.parse({ type: 'goto', url: '/users/1' })).toEqual({ type: 'goto', url: '/users/1' })
    expect(ScenarioStepSchema.parse({ type: 'waitFor', selector: '[data-page]' })).toEqual({ type: 'waitFor', selector: '[data-page]' })
    expect(ScenarioStepSchema.parse({ type: 'waitForRequest', urlPattern: '/api/users' })).toEqual({ type: 'waitForRequest', urlPattern: '/api/users' })
    expect(ScenarioStepSchema.parse({ type: 'assertFieldVisible', field: 'user.name' })).toEqual({ type: 'assertFieldVisible', field: 'user.name' })
    expect(ScenarioStepSchema.parse({ type: 'screenshot' })).toEqual({ type: 'screenshot' })
  })

  it('step id optional（SP2）+ 非法 type / 空 url 拒绝', () => {
    expect(ScenarioStepSchema.parse({ type: 'goto', url: '/x', id: 'open-x' }).id).toBe('open-x')
    expect(() => ScenarioStepSchema.parse({ type: 'hover', selector: 'x' })).toThrow()
    expect(() => ScenarioStepSchema.parse({ type: 'goto', url: '' })).toThrow()
  })
})

describe('ScenarioFileSchema', () => {
  it('version 必须 = 1；steps 1-50；id kebab 门', () => {
    expect(() => ScenarioFileSchema.parse({ ...base, version: 2 })).toThrow()
    expect(() => ScenarioFileSchema.parse({ ...base, scenarios: [{ id: 's', name: 'n', steps: [] }] })).toThrow()
    expect(() => ScenarioFileSchema.parse({ ...base, scenarios: [{ id: 'BAD ID', name: 'n', steps: [{ type: 'screenshot' }] }] })).toThrow()
    const ok = ScenarioFileSchema.parse({
      version: 1,
      scenarios: [{ id: 's1', name: 'n', route: '/users/1', steps: [{ type: 'screenshot' }] }],
    })
    expect(ok.scenarios[0]!.steps).toHaveLength(1)
  })

  it('51 步拒绝（上限门）', () => {
    const steps = Array.from({ length: 51 }, () => ({ type: 'waitFor' as const, selector: 'x' }))
    expect(() => ScenarioFileSchema.parse({ ...base, scenarios: [{ id: 's', name: 'n', steps }] })).toThrow()
  })
})
