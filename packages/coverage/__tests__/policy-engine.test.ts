/**
 * §21.5 优先级矩阵逐行 + matchedRule 记录 + counted* 联动（spec §3.2）。
 * 优先级：user required > user ignored > user optional > default（schema required ? required : optional）> unknown
 */
import { describe, it, expect } from 'vitest'
import { evaluatePolicy, type ManifestFieldLike } from '../src/policy/index.js'
import { matchGlob } from '../src/policy/index.js'

const f = (id: string, normalizedPath: string, required?: boolean): ManifestFieldLike => ({ id, normalizedPath, required })

describe('evaluatePolicy — §21.5 优先级', () => {
  const fields = [
    f('f1', 'data.user.metadata.displayName', true), // schema required，同时被 user ignored 覆盖
    f('f2', 'data.internalRiskScore', false),
    f('f3', 'data.name', true),
    f('f4', 'data.tags[]', false),
  ]
  const policy = { required: [], optional: [], ignored: ['**.metadata.**', 'data.internalRiskScore'] }

  it('user required > user ignored（plan §21.5 示例语义）', () => {
    const d = evaluatePolicy([{ ...fields[0]!, required: true }], {
      required: ['data.user.metadata.displayName'],
      ignored: ['**.metadata.**'],
    })[0]!
    expect(d.status).toBe('required')
    expect(d.matchedRule).toEqual({ source: 'user-config', pattern: 'data.user.metadata.displayName' })
    expect(d.countedInRequiredCoverage).toBe(true)
    expect(d.countedInEffectiveCoverage).toBe(true)
  })
  it('user ignored > default-required；ignored 不进任何分母（§21.1）', () => {
    const d = evaluatePolicy([fields[0]!], policy)[0]!
    expect(d.status).toBe('ignored')
    expect(d.matchedRule).toEqual({ source: 'user-config', pattern: '**.metadata.**' })
    expect(d.countedInRequiredCoverage).toBe(false)
    expect(d.countedInEffectiveCoverage).toBe(false)
  })
  it('user ignored 命中 optional 字段', () => {
    const d = evaluatePolicy([fields[1]!], policy)[0]!
    expect(d.status).toBe('ignored')
    expect(d.matchedRule?.pattern).toBe('data.internalRiskScore')
  })
  it('default：schema required → required（matchedRule source=default）', () => {
    const d = evaluatePolicy([fields[2]!], policy)[0]!
    expect(d.status).toBe('required')
    expect(d.matchedRule).toEqual({ source: 'default', pattern: 'schema.required', reason: 'OpenAPI required 标记' })
  })
  it('default：非 required → optional', () => {
    const d = evaluatePolicy([fields[3]!], policy)[0]!
    expect(d.status).toBe('optional')
    expect(d.countedInRequiredCoverage).toBe(false)
    expect(d.countedInEffectiveCoverage).toBe(true)
  })
  it('unknown：无字段匹配时……不存在此态（default 必产 optional/required）——unknown 仅当字段缺 required 属性且无规则时', () => {
    // ManifestFieldLike.required 缺省视为 false → optional。unknown 由 analyzer 对 policy
    // 决策之外的路径产生（spec §3.3），engine 层单测锁定：decision 集合与输入一一对应
    const ds = evaluatePolicy(fields, policy)
    expect(ds).toHaveLength(4)
    expect(ds.every((d) => ['required', 'optional', 'ignored'].includes(d.status))).toBe(true)
  })
  it('同列表内按声明顺序取首个命中', () => {
    const d = evaluatePolicy([{ ...fields[1]!, required: false }], {
      ignored: ['data.*', 'data.internalRiskScore'],
    })[0]!
    expect(d.matchedRule?.pattern).toBe('data.*')
  })
  it('fieldId/fieldPath 直传', () => {
    const d = evaluatePolicy([fields[2]!], policy)[0]!
    expect(d.fieldId).toBe('f3')
    expect(d.fieldPath).toBe('data.name')
  })
})

describe('evaluatePolicy — C2 对象条目（string | {pattern, reason}）', () => {
  it('对象条目：pattern 匹配 + reason 透出', () => {
    const d = evaluatePolicy(
      [f('f1', 'data.internalRiskScore', false)],
      { ignored: [{ pattern: 'data.internalRiskScore', reason: '内部风控字段，不应展示' }] },
    )[0]!
    expect(d.status).toBe('ignored')
    expect(d.matchedRule).toEqual({ source: 'user-config', pattern: 'data.internalRiskScore', reason: '内部风控字段，不应展示' })
  })
  it('对象条目无 reason → matchedRule 不含 reason 键', () => {
    const d = evaluatePolicy([f('f1', 'data.name', true)], { required: [{ pattern: 'data.name' }] })[0]!
    expect(d.matchedRule).toEqual({ source: 'user-config', pattern: 'data.name' })
  })
  it('混合列表：string 与对象条目共存，按声明顺序取首个命中', () => {
    const d = evaluatePolicy([f('f1', 'data.name', true)], {
      required: ['data.*', { pattern: 'data.name', reason: '用户主标识' }],
    })[0]!
    expect(d.matchedRule).toEqual({ source: 'user-config', pattern: 'data.*' })
    const d2 = evaluatePolicy([f('f2', 'data.user.name', true)], {
      required: ['data.*', { pattern: '**.name', reason: '用户主标识' }],
    })[0]!
    expect(d2.matchedRule).toEqual({ source: 'user-config', pattern: '**.name', reason: '用户主标识' })
  })
})
