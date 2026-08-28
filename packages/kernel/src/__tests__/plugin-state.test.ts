/**
 * Plugin State Machine 可观测性测试 (M1)
 *
 * 验证：
 * - 每个插件的 lifecycle 状态对外可见
 * - state-change 事件被正确发出到 events.jsonl
 * - getState().pluginStates 反映当前状态
 * - 加载失败时状态正确转为 failed
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createKernel } from '../kernel'
import type { Plugin } from '../plugin'

let workDir: string
let configPath: string

function setup(): void {
  workDir = mkdtempSync(join(tmpdir(), 'nx-mk-state-'))
  configPath = join(workDir, 'nx-mk.config.yml')
  writeFileSync(configPath, 'plugins: []\nlogLevel: info\noutputDir: ./.nx-mk/runs\n')
}

function teardown(): void {
  rmSync(workDir, { recursive: true, force: true })
}

function readEvents(runId: string): Array<Record<string, unknown>> {
  const eventsPath = join(workDir, '.nx-mk', 'runs', runId, 'events.jsonl')
  const content = readFileSync(eventsPath, 'utf8')
  return content.trim().split('\n').map((l) => JSON.parse(l))
}

describe('M1: Plugin State Machine', () => {
  it('tracks plugin state in getState().pluginStates after successful load', async () => {
    setup()
    try {
      const p: Plugin = {
        name: '@nx-mk/state-plugin',
        version: '1.0.0',
        hooks: {},
      }
      const kernel = createKernel({
        configPath,
        runId: 'm1-r1' as never,
        subcommand: 'run',
        cwd: workDir,
        plugins: [p],
      })
      await kernel.run()
      const state = kernel.getState()
      expect(state.pluginStates).toBeInstanceOf(Map)
      expect(state.pluginStates.has('@nx-mk/state-plugin')).toBe(true)
      const pluginState = state.pluginStates.get('@nx-mk/state-plugin')
      // 终态应该是 active（成功完成 run 后）或 done（如果已声明完成）
      expect(pluginState?.kind).toBeDefined()
    } finally {
      teardown()
    }
  })

  it('emits plugin:state-change events during plugin lifecycle', async () => {
    setup()
    try {
      const p: Plugin = {
        name: '@nx-mk/observer',
        version: '1.0.0',
        hooks: {},
      }
      const kernel = createKernel({
        configPath,
        runId: 'm1-r2' as never,
        subcommand: 'run',
        cwd: workDir,
        plugins: [p],
      })
      await kernel.run()
      const events = readEvents('m1-r2')
      const stateChanges = events.filter((e) => e.type === 'plugin:state-change')
      expect(stateChanges.length).toBeGreaterThan(0)
      // 至少有一个事件是关于 @nx-mk/observer 的
      const observerEvents = stateChanges.filter((e) => e.name === '@nx-mk/observer')
      expect(observerEvents.length).toBeGreaterThan(0)
      // 最后一个事件应该是 active 终态
      const lastEvent = observerEvents[observerEvents.length - 1]
      expect(lastEvent?.to).toBe('active')
    } finally {
      teardown()
    }
  })

  it('marks plugin as failed when load throws', async () => {
    setup()
    try {
      const failing: Plugin = {
        name: '@nx-mk/failing',
        version: '1.0.0',
        hooks: {
          beforeRun: () => {
            throw new Error('intentional-failure')
          },
        },
      }
      const kernel = createKernel({
        configPath,
        runId: 'm1-r3' as never,
        subcommand: 'run',
        cwd: workDir,
        plugins: [failing],
      })
      await expect(kernel.run()).rejects.toThrow()
      const state = kernel.getState()
      expect(state.pluginStates.has('@nx-mk/failing')).toBe(true)
      const pluginState = state.pluginStates.get('@nx-mk/failing')
      expect(pluginState?.kind).toBe('failed')
    } finally {
      teardown()
    }
  })

  it('preserves loadedPlugins array for backward compatibility', async () => {
    setup()
    try {
      const p: Plugin = {
        name: '@nx-mk/compat',
        version: '1.0.0',
        hooks: {},
      }
      const kernel = createKernel({
        configPath,
        runId: 'm1-r4' as never,
        subcommand: 'run',
        cwd: workDir,
        plugins: [p],
      })
      await kernel.run()
      const state = kernel.getState()
      // loadedPlugins 应继续存在（M1 不破坏现有 API）
      expect(Array.isArray(state.loadedPlugins)).toBe(true)
      expect(state.loadedPlugins).toContain('@nx-mk/compat')
    } finally {
      teardown()
    }
  })
})
