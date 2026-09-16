/**
 * Ruling 5（Task 7 审查 Adjudication B）追加缝单测：
 * - extraPlugins：配置插件加载完成后追加程序化插件（run.ts 代码装配 plugin-playwright 用），
 *   与测试注入路径（opts.plugins 替换）语义一致；
 * - excludePluginNames：从配置 plugins 数组过滤指定包名（防同插件双实例双 launch）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createKernel } from '../kernel'
import type { Plugin } from '../plugin'

let workDir: string
let configPath: string

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'nx-mk-plugin-assembly-'))
  configPath = join(workDir, 'nx-mk.config.yml')
})

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true })
})

function writeConfig(plugins: string[] = []): void {
  const pluginsLine = plugins.length === 0
    ? 'plugins: []\n'
    : `plugins:\n${plugins.map((p) => `  - '${p}'\n`).join('')}`
  writeFileSync(configPath, `${pluginsLine}logLevel: info\n`)
}

/** 记录钩子调用的惰性插件（beforeRun 计数供断言） */
function inertPlugin(name: string): Plugin & { beforeRunCalls: number } {
  const p: Plugin & { beforeRunCalls: number } = {
    name,
    version: '0.1.0',
    beforeRunCalls: 0,
    hooks: {
      beforeRun() {
        p.beforeRunCalls += 1
      },
    },
  }
  return p
}

describe('Ruling 5 追加缝：extraPlugins / excludePluginNames', () => {
  it('extraPlugins 在配置插件之后追加，钩子照常执行且计入 pluginStates', async () => {
    writeConfig() // plugins: []
    const extra = inertPlugin('@nx-mk/extra-plugin')
    const kernel = createKernel({
      configPath,
      runId: 'r_extra' as never,
      subcommand: 'run',
      cwd: workDir,
      extraPlugins: [extra],
    })
    await kernel.run()
    expect(extra.beforeRunCalls).toBe(1)
    const state = kernel.getState()
    expect(state.loadedPlugins).toContain('@nx-mk/extra-plugin')
    expect(state.pluginStates.get('@nx-mk/extra-plugin')?.kind).toBe('active')
  })

  it('测试注入路径（opts.plugins）同样支持 extraPlugins 追加', async () => {
    writeConfig()
    const injected = inertPlugin('@nx-mk/injected')
    const extra = inertPlugin('@nx-mk/extra-plugin')
    const kernel = createKernel({
      configPath,
      runId: 'r_inject' as never,
      subcommand: 'run',
      cwd: workDir,
      plugins: [injected],
      extraPlugins: [extra],
    })
    await kernel.run()
    expect(injected.beforeRunCalls).toBe(1)
    expect(extra.beforeRunCalls).toBe(1)
  })

  it('excludePluginNames 过滤配置 plugins 数组（被排除的包不再加载）', async () => {
    // 'nx-mk-nonexistent-plugin-xyz' 真去加载必然 PLUGIN_LOAD_FAILED；
    // 排除名单生效时 loadPlugins 收到空数组 → run 正常完成
    writeConfig(['nx-mk-nonexistent-plugin-xyz'])
    const kernel = createKernel({
      configPath,
      runId: 'r_exclude' as never,
      subcommand: 'run',
      cwd: workDir,
      excludePluginNames: ['nx-mk-nonexistent-plugin-xyz'],
    })
    await kernel.run()
    expect(kernel.getState().loadedPlugins).toEqual([])
  })

  it('未排除时同名配置插件照常走加载失败（对照：排除是过滤生效的唯一原因）', async () => {
    writeConfig(['nx-mk-nonexistent-plugin-xyz'])
    const kernel = createKernel({
      configPath,
      runId: 'r_noexclude' as never,
      subcommand: 'run',
      cwd: workDir,
    })
    await expect(kernel.run()).rejects.toMatchObject({ code: 'PLUGIN_LOAD_FAILED' })
  })
})
