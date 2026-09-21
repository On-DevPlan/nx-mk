/**
 * loadScenarios（spec E1/E4 + SP1）：路径段 glob / 多文件合并 / 形状门跳过 / 同 id 去重。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { globToRegExp, loadScenarios } from '../dsl-loader'

const FILE_A = { version: 1, scenarios: [{ id: 'user-profile', name: '用户详情', steps: [{ type: 'goto', url: '/users/1' }] }] }
const FILE_B = { version: 1, scenarios: [{ id: 'checkout', name: '结账', steps: [{ type: 'screenshot' }] }] }

describe('globToRegExp（SP1 路径段语义）', () => {
  it('** 跨段 / * 单段 / 字面转义', () => {
    expect(globToRegExp('mk/scenarios/**/*.yml').test('mk/scenarios/a/b.yml')).toBe(true)
    expect(globToRegExp('mk/scenarios/**/*.yml').test('mk/scenarios/a/b.json')).toBe(false)
    expect(globToRegExp('scenarios/*.yml').test('scenarios/a.yml')).toBe(true)
    expect(globToRegExp('scenarios/*.yml').test('scenarios/a/b.yml')).toBe(false)
    expect(globToRegExp('scenarios/a(x).yml').test('scenarios/a(x).yml')).toBe(true)
  })
})

describe('loadScenarios', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nx-mk-scen-'))
    mkdirSync(join(dir, 'mk/scenarios'), { recursive: true })
    writeFileSync(join(dir, 'mk/scenarios/a.yml'), JSON.stringify(FILE_A), 'utf8')
    writeFileSync(join(dir, 'mk/scenarios/b.yml'), JSON.stringify(FILE_B), 'utf8')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('glob 命中多文件 → 场景合并（JSON 也是合法 YAML 子集）', () => {
    const r = loadScenarios(dir, ['mk/scenarios/**/*.yml'])
    expect(r.scenarios.map((s) => s.scenario.id).sort()).toEqual(['checkout', 'user-profile'])
    expect(r.skipped).toEqual([])
  })

  it('E1：形状非法文件跳过并给原因；0 命中 → 空数组', () => {
    writeFileSync(join(dir, 'mk/scenarios/bad.yml'), 'version: 9\n', 'utf8')
    const r = loadScenarios(dir, ['mk/scenarios/*.yml'])
    expect(r.scenarios).toHaveLength(2)
    expect(r.skipped).toHaveLength(1)
    expect(r.skipped[0]).toContain('bad.yml')
    expect(loadScenarios(dir, ['nope/**/*.yml']).scenarios).toEqual([])
  })

  it('跨文件同 id → 首个胜出，后者进 skipped', () => {
    writeFileSync(join(dir, 'mk/scenarios/dup.yml'), JSON.stringify(FILE_A), 'utf8')
    const r = loadScenarios(dir, ['mk/scenarios/**/*.yml'])
    expect(r.scenarios.filter((s) => s.scenario.id === 'user-profile')).toHaveLength(1)
    expect(r.skipped.some((s) => s.includes('dup.yml'))).toBe(true)
  })
})
